# Production Deployment Topology & Infrastructure Architecture

This document specifies the production infrastructure architecture on AWS for the **Node.js Scalable Foundation** backend API and the **Next.js Frontend Foundation**.

---

## 1. Network & Compute Topology

```
                                 ┌─────────────────────────┐
                                 │   Route 53 DNS & WAF    │
                                 └────────────┬────────────┘
                                              │
                                              ▼
                         ┌─────────────────────────────────────────┐
                         │      AWS Application Load Balancer      │
                         │    (Dual-Stack HTTPS / TLS 1.3 Termination)  │
                         └────────────┬───────────────┬────────────┘
                                      │               │
                     Path: /api/*, /socket.io/*        Default: /*
                                      │               │
                                      ▼               ▼
                  ┌───────────────────────┐       ┌───────────────────────┐
                  │ ECS Fargate: app-api  │       │ ECS Fargate: app-web  │
                  │ (Express REST + WSS)  │       │ (Next.js App Router)  │
                  │  Min: 2 / Max: 10     │       │   Min: 2 / Max: 10    │
                  └───────────┬───────────┘       └───────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────┐ ┌───────────────────┐
│ ECS Fargate:      │ │ AWS S3 Bucket │ │ AWS Secrets       │
│ app-worker        │ │ (Uploads &    │ │ Manager           │
│ (BullMQ Processors│ │ Audit Cold    │ │ (Env encryption,  │
│ & Cron Schedulers)│ │ Storage)      │ │ keys & secrets)   │
└─────────┬─────────┘ └───────────────┘ └───────────────────┘
          │
          ├──────────────────────────────┐
          ▼                              ▼
┌───────────────────────────────┐ ┌───────────────────────────────┐
│ Amazon ElastiCache (Redis 7)  │ │ Amazon RDS PostgreSQL 16      │
│ Cluster (In-Transit & At-Rest │ │ Multi-AZ Cluster with RDS     │
│ Encryption enabled)           │ │ Proxy / PgBouncer             │
│ DB 0: Cache & Mutex           │ │ Max Connections: 300          │
│ DB 1: BullMQ Queues           │ │ DB_POOL_MAX per task: 10      │
│ DB 2: Socket.IO Adapter Sync  │ │ Automated Daily Backups       │
│ DB 3: Rate Limiting Counters  │ │ PITR: 35 Days Retention       │
└───────────────────────────────┘ └───────────────────────────────┘
```

---

## 2. Infrastructure Components

### 2.1 Load Balancing & Routing (ALB)
- **ALB Rules**:
  - `admin.example.com/*` -> Routed to `app-web` (Platform Console) or `app-api` under `/api/v1/platform/*`.
  - `api.example.com/*` and `/api/*` -> Forwarded to `app-api` target group (HTTP port 3000).
  - `/socket.io/*` -> Forwarded to `app-api` target group with sticky sessions disabled (pure WebSocket transport).
  - Default rule `/*` -> Forwarded to `app-web` target group (Next.js port 3000).
- **Health Checks**:
  - `app-api`: Target group health check path `/health/ready`, interval 15s, timeout 5s, 2 healthy thresholds.
  - `app-web`: Target group health check path `/api/health`, interval 15s, timeout 5s, 2 healthy thresholds.

### 2.2 ECS Fargate Compute Tasks
- **`app-api`**:
  - Stateless REST API and Socket.IO server.
  - Memory: 1024 MB, CPU: 512 Units.
  - Auto-scaling metric: Average CPU > 70% or Target ALB Request Count > 1000 req/target.
  - `stopTimeout`: 60s (graceful HTTP keep-alive termination and WebSocket disconnect).
- **`app-worker`**:
  - Dedicated background process decoupled from HTTP requests.
  - Runs email dispatchers, media/file processors, audit retention purges, and cron schedulers.
  - Memory: 1024 MB, CPU: 512 Units.
  - `stopTimeout`: 120s (allows active BullMQ jobs to finish before SIGKILL).
- **`app-web`**:
  - Server-side rendered Next.js frontend with BFF route handlers.
  - Memory: 1024 MB, CPU: 512 Units.

### 2.3 Database Tier (PostgreSQL + Connection Budgeting)
- **Engine**: PostgreSQL 16 Multi-AZ.
- **Connection Budget Formula**:
  $$\text{Total Connections} = (N_{\text{api}} + N_{\text{worker}}) \times \text{DB\_POOL\_MAX} + N_{\text{admin}}$$
  - Example: $(5 \text{ API tasks} + 2 \text{ Worker tasks}) \times 10 = 70 \text{ connections} \ll 300 \text{ max connections}$.
- **Tenancy Architecture**:
  - Primary pooled database for platform, users, and multi-tenant shared tables.
  - Optional dedicated tenant databases routed via `src/db/tenancy/context.ts` without cross-database foreign key joins.
- **Backup & PITR**:
  - Multi-AZ synchronous replication with automatic failover (< 60s).
  - Daily snapshot retained for 30 days.
  - Continuous WAL archiving with Point-in-Time Recovery (PITR) with 35 days window.

### 2.4 Caching & Messaging Tier (ElastiCache Redis)
- **Engine**: Redis 7.x with replication group (1 Primary + 1 Read Replica).
- **Logical Database Segmentation**:
  - `CACHE_REDIS_URL`: `redis://elasticache:6379/0` (Cache-aside with stampede mutex locks)
  - `QUEUE_REDIS_URL`: `redis://elasticache:6379/1` (BullMQ queues and job state)
  - `SOCKET_REDIS_URL`: `redis://elasticache:6379/2` (Socket.IO Redis adapter and event emitter)
  - Rate Limiting: `redis://elasticache:6379/3` (Sliding window rate limit counters)

---

## 3. Secrets Management & Security

All sensitive values are stored in **AWS Secrets Manager** and injected into ECS container definitions at launch:

| Secret Name | Usage | Rotation Policy |
| :--- | :--- | :--- |
| `app/prod/jwt-access-secret` | Signs 15-min JWT access tokens | Key version rollover |
| `app/prod/jwt-refresh-secret` | Signs 7-day refresh tokens | Key version rollover |
| `app/prod/jwt-platform-secret` | Signs platform operator JWT tokens | Key version rollover |
| `app/prod/jwt-support-secret` | Signs break-glass impersonation tokens | 90 days |
| `app/prod/encryption-key` | AES-256-GCM envelope encryption | See `docs/secret-rotation.md` |
| `app/prod/bff-shared-secret` | Internal Next.js BFF -> Express auth | Dual-secret rollover |
| `app/prod/internal-api-secret` | Cron, orchestrator, and Caddy hooks | 90 days |

---

## 4. Monitoring, Telemetry & CloudWatch Alarms

The system exports Prometheus metrics at `/metrics` and sends structured JSON logs to CloudWatch `/ecs/app-api`, `/ecs/app-worker`, and `/ecs/app-web`.

### Critical Production Alarms:
1. **API 5xx Rate Alarm**:
   - Metric: CloudWatch HTTPCode_Target_5XX_Count > 1% of total requests over 3 consecutive 1-minute periods.
   - Severity: CRITICAL (P1 pager).
2. **Database Connection Saturation Alarm**:
   - Metric: RDS `DatabaseConnections` > 80% of max allowed connections.
   - Severity: HIGH.
3. **Queue Dead Letter / Stalled Job Alarm**:
   - Metric: BullMQ queue failed job count > 10 over 5 minutes.
   - Severity: MEDIUM.
4. **ECS Migration Task Failure Alarm**:
   - Metric: Exit code $\neq$ 0 on `dist/db/migrate-all.js` one-off ECS task.
   - Severity: BLOCKER (halts deployment immediately).

---

## 5. Deployment & Rollback Strategy

### 5.1 Zero-Downtime Rolling Deployments
ECS rolling deployment configuration:
- `minimumHealthyPercent`: 100%
- `maximumPercent`: 200%

When a new image is pushed to Amazon ECR:
1. The one-off migration task runs `node dist/db/migrate-all.js` against the primary DB and all dedicated tenant databases.
2. Once migrations succeed, ECS launches new Fargate tasks running the new container image.
3. New tasks must pass ALB health checks (`/health/ready`) for 30 consecutive seconds.
4. Traffic smoothly shifts to new tasks; old tasks receive `SIGTERM` and have 60 seconds (`stopTimeout`) to finish inflight requests.

### 5.2 Expand-Contract Database Schema Invariant
To support zero-downtime rolling updates and instant rollbacks:
- **Phase 1 (Expand)**: Add nullable columns or new tables in migrations. Both old and new replicas can run concurrently.
- **Phase 2 (Deploy)**: Deploy application tasks that write to the new schema structures.
- **Phase 3 (Contract)**: Drop or rename legacy columns in a subsequent release after all old replicas have been replaced.

### 5.3 Automated Rollback Procedure
If ECS health checks fail or CloudWatch 5xx alarms trigger post-deployment:
1. ECS deployment circuit breaker automatically rolls back the service to the previous Task Definition ARN.
2. Because all database migrations adhere to the Expand-Contract pattern, the previous code version remains 100% compatible with the database schema without requiring an immediate database rollback.
