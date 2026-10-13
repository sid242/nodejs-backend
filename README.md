# Node.js Scalable Foundation

Production-ready, scalable Node.js & TypeScript backend foundation built with **Express**, **PostgreSQL (Drizzle ORM)**, **Redis**, **BullMQ**, **Socket.IO**, and **AWS S3 / SES**, containerized and architected for independent horizontal scaling on AWS ECS Fargate.

---

## Architecture

```
                 ┌────────────── ALB / Nginx ──────────────┐
 Browser ───────▶│ HTTPS + WebSocket (/socket.io)          │
   │             └───────┬─────────────────────┬───────────┘
   │ direct upload       ▼                     ▼
   ▼                ┌─────────┐  ...N  ┌─────────┐        ┌────────────┐
  S3  ◀──presigned──│ API #1  │        │ API #N  │───────▶│ Postgres   │
  (CORS)            └────┬────┘        └────┬────┘        │ (RDS)      │
                         │ cache, rate limit, refresh tokens, pub/sub, queues
                         ▼                  ▼
                    ┌─────────────────────────────┐
                    │ Redis (ElastiCache)         │
                    └──────────────┬──────────────┘
                                   ▼
                          ┌────────────────┐   SES, S3, DB
                          │ Worker x M     │──────────────▶
                          └────────────────┘   emits socket events via Redis
```

- **Stateless API Replicas**: All state (refresh tokens, cache, rate limits, WebSocket adapter sync) lives in Redis, Postgres, or S3, allowing API and worker replicas to scale horizontally and independently.
- **Dedicated Background Workers**: Heavy I/O, scheduled jobs, email delivery, and media processing execute in decoupled worker processes (`src/worker.ts`).
- **Standardized Response Envelopes**:
  - Success: `{ success: true, message: string, data: any, meta?: any, requestId: string }`
  - Error: `{ error: { code: string, message: string, details?: any }, requestId: string }`
  - Operational endpoints (`/health/*`, `/metrics`, `/docs`) retain their standard HTTP formats.

---

## Quick Start

```bash
cp .env.example .env            # set the two JWT secrets (32+ chars)
npm install                     # install dependencies (Node >= 20.6)
docker compose up -d            # start local Postgres, Redis, and MinIO (S3)
npm run db:generate             # generate Drizzle migrations from schema
npm run db:migrate              # apply database migrations
npm run db:seed                 # (optional) seed default system roles & permissions
npm run dev                     # run API server in watch mode (terminal 1)
npm run dev:worker              # run background workers in watch mode (terminal 2)
```

Full containerised stack with load balancing:

```bash
docker compose --profile full up -d --build --scale api=3
```

Then access the API at `http://localhost:8080`. (In full profile, presigned S3 URLs point to `minio:9000`, which is an internal container hostname; use `npm run dev` for local upload testing).

---

## Directory & Feature Layout

| Concern                    | Location                                                | Notes                                                                                   |
| :------------------------- | :------------------------------------------------------ | :-------------------------------------------------------------------------------------- |
| **Language & Runtime**     | `tsconfig.json`, `package.json`                         | 100% TypeScript ESM (`"type": "module"`), Node >=20.6, path alias `@/*`                 |
| **Database & ORM**         | `src/db/schema/`, `src/config/db.ts`                    | PostgreSQL with Drizzle ORM, connection pool budget, typed schema definitions           |
| **Config & Validation**    | `src/config/env.ts`                                     | Strict Zod validation; crashes on missing env; explicit pool, timeouts, and caps        |
| **Logging**                | `src/config/logger.ts`, `src/middleware/http-logger.ts` | Structured Pino JSON logging, sensitive field redaction, `x-request-id` propagation     |
| **Redis Cache**            | `src/lib/cache.ts`                                      | Cache-aside pattern with distributed mutex stampede lock and SCAN invalidation          |
| **Rate Limiting**          | `src/middleware/rate-limit.ts`                          | Redis-backed sliding window rate limiters (global, auth endpoints, per-user)            |
| **Authentication**         | `src/modules/auth`                                      | bcrypt password hashing, short-lived JWT access tokens, rotating refresh tokens         |
| **Sessions & Devices**     | `src/db/schema/sessions.ts`                             | Multi-device session tracking, IP and user-agent logging, remote revocation             |
| **Email & Verification**   | `src/db/schema/verification-tokens.ts`                  | SHA-256 deterministic hash tokens for email verification & password resets              |
| **Multi-Tenancy**          | `src/modules/tenants`, `src/middleware/tenant.ts`       | Organization isolation via `x-tenant-id`, membership verification, status checks        |
| **Dynamic RBAC**           | `src/modules/rbac`, `src/middleware/rbac.ts`            | Decentralized permissions catalog, system roles, custom tenant roles & guards           |
| **Compliance Audit Trail** | `src/modules/audit`, `src/db/schema/audit-logs.ts`      | Immutable audit log (actor, tenant, resource, action, IP, diff metadata)                |
| **S3 Direct Uploads**      | `src/lib/s3.ts`, `src/modules/files`                    | Presigned POST with strict MIME/size caps, confirmation step, presigned GET             |
| **Background Queues**      | `src/queues`, `src/worker.ts`                           | BullMQ with retries, exponential backoff, Bull-Board UI at `/admin/queues`              |
| **Cron & Schedulers**      | `src/queues/workers/index.ts`                           | BullMQ repeatable job schedulers (safe across multi-replica deployments)                |
| **Real-time WebSockets**   | `src/sockets`                                           | Socket.IO with Redis adapter, JWT handshake, rooms, worker-to-client emitter            |
| **Health Checks**          | `src/modules/health`                                    | `/health/live`, `/health/ready` (checks DB + Redis, returns 503 during graceful drain)  |
| **Interactive API Docs**   | `src/docs/`                                             | Swagger UI at `/docs`, OpenAPI 3.0 specification at `/docs/openapi.json`                |
| **Metrics & Telemetry**    | `src/observability/metrics.ts`                          | Prometheus `/metrics` collector (blocked by default at Nginx proxy)                     |
| **Graceful Shutdown**      | `src/server.ts`, `src/worker.ts`                        | Drains load balancer, closes WebSockets, queues, DB pool; workers finish in-flight jobs |
| **Container & CI/CD**      | `Dockerfile`, `.github/workflows/`, `deploy/`           | Multi-stage Docker image, GitHub Actions CI, ECS Fargate task definitions               |

---

## Core Capabilities & Workflows

### 1. Multi-Tenancy & Tenant Context

Every tenant-scoped request resolves organization context through `src/middleware/tenant.ts`:

- Accepts `x-tenant-id` header (UUID or slug), query parameter, or path parameter.
- Verifies tenant status (`ACTIVE` or `TRIALING`).
- Checks user membership in the tenant (`TenantMember`).
- Injects `req.tenant`, `req.membership`, and user permissions onto the Express `Request`.

```bash
# Example authenticated tenant request:
curl -H "Authorization: Bearer <TOKEN>" \
     -H "x-tenant-id: dental-clinic-central" \
     http://localhost:3000/api/v1/tenants/current
```

### 2. Dynamic RBAC (Role-Based Access Control)

The RBAC engine supports system roles (`OWNER`, `ADMIN`, `MEMBER`) and custom tenant roles:

- **Decentralized Module Permissions**: Each module registers its permissions in `src/modules/rbac/modules.registry.ts` (e.g. `files:read`, `tenants:update`, `members:invite`).
- **Route Guards**:
  - `requirePermission('files:write')`: Requires explicit permission or wildcard `*`.
  - `requirePermissions(['members:read', 'members:invite'])`: Requires all specified permissions.
  - `requireAnyPermission(['audit:read', 'roles:read'])`: Requires at least one permission.
  - `requireTenantRole('OWNER')`: Enforces specific role level.

### 3. S3 Direct Upload Flow

1. `POST /api/v1/files/upload-url` `{ filename, contentType }` -> returns `{ fileId, upload: { url, fields } }`
2. Browser directly `POST`s `multipart/form-data` (form fields, then binary file) to S3/MinIO.
3. `POST /api/v1/files/:id/confirm` -> server verifies object existence, validates size, and queues a processing job.
4. Background worker processes the file and emits `file:processed` via WebSocket.
5. `GET /api/v1/files/:id/download-url` -> returns a short-lived presigned GET URL.

### 4. Audit Logging & Compliance

Changes to sensitive resources (tenants, members, roles, files) are recorded to the immutable `audit_logs` table:

- Captures `tenantId`, `actorId`, `action` (`CREATE`, `UPDATE`, `DELETE`, `READ`), `resource`, `resourceId`.
- Records client metadata (`ipAddress`, `userAgent`) and JSON `diff` (before/after states).
- Queryable by tenant owners and compliance officers via `/api/v1/audit`.

### 5. Secure, Audited Impersonation

Administrators can assume user identities for support and troubleshooting with strict compliance guardrails:

- **Time-Boxed Access Tokens**: Short-lived JWTs (default 30 min) without refresh tokens, tied to an active Redis session.
- **Dual-Identity Context**: Downstream logic executes as `req.user` (target user), while audit loggers and security guards retain `req.impersonator` (the real admin).
- **Security Guardrails**:
  - `blockIfImpersonating()` blocks password changes and credential modification while impersonating.
  - Prevents impersonating another administrator (privilege escalation prevention).
  - Mandatory audit events on session start (`AUTH_IMPERSONATE_START`) and session exit (`AUTH_IMPERSONATE_STOP`).

```bash
# Start impersonation (Admin only)
curl -X POST http://localhost:3000/api/v1/auth/impersonate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId": "<USER_UUID>", "reason": "Debugging invoice display", "durationMinutes": 30}'

# Exit impersonation session
curl -X POST http://localhost:3000/api/v1/auth/stop-impersonate \
  -H "Authorization: Bearer <IMPERSONATION_TOKEN>"
```

---

## Useful Commands

| Command               | Description                                                         |
| :-------------------- | :------------------------------------------------------------------ |
| `npm run dev`         | Run API server with file watch (`tsx watch --env-file=.env`)        |
| `npm run dev:worker`  | Run Background Worker with file watch (`tsx watch --env-file=.env`) |
| `npm run typecheck`   | Run TypeScript compiler type checking (`tsc --noEmit`)              |
| `npm test`            | Run test suites using tsx test runner (`tsx --test`)                |
| `npm run lint`        | Run ESLint checks                                                   |
| `npm run lint:fix`    | Fix linting errors automatically                                    |
| `npm run format`      | Format codebase using Prettier                                      |
| `npm run db:generate` | Generate SQL migrations from Drizzle schemas                        |
| `npm run db:migrate`  | Execute pending database migrations                                 |
| `npm run db:seed`     | Seed default system permissions and roles                           |

---

## AWS Deployment Shape (ECS Fargate)

- **Compute:** ECS Fargate, two services from the same container image:
  - `app-api`: Behind an Application Load Balancer (target-tracking on CPU/requests).
  - `app-worker`: Headless worker process (scales on BullMQ queue depth via CloudWatch).
- **Database:** RDS PostgreSQL (+ RDS Proxy for pool multiplexing under high concurrency).
- **Cache & Queues:** ElastiCache Redis (`maxmemory-policy noeviction` required for BullMQ).
- **Network:** ALB in public subnets; Fargate tasks, RDS, and Redis in private subnets.
- **Secrets:** AWS Secrets Manager injected directly via the ECS task definition `secrets` block. No plaintext credentials in environment variables.
- **ALB Configuration:** Idle timeout 60s (Node keep-alive set to 65s), health check endpoint `/health/ready`, deregistration delay ~30s.

---

## Scaling Rules of Thumb

1. **Zero Process Memory State**: Sessions, rate limits, WebSocket rooms, and locks live in Redis. Replicas can be destroyed or added at any moment.
2. **Postgres Connection Budget**: Total connections across `(API Replicas + Worker Replicas) * DB_POOL_MAX` must remain below PostgreSQL `max_connections`.
3. **Idempotent Background Jobs**: Every BullMQ processor must handle retries safely; use deterministic `jobId` for deduplication.
4. **Cache Stampede Prevention**: Wrap high-traffic database queries in `cache.wrap(key, ttl, fetcher)` to utilize Redis distributed mutex locks.

---

## Production Roadmap & Status

- [x] Full TypeScript ESM migration with strict type checking and path aliases (`@/*`)
- [x] OpenAPI 3.0 documentation & interactive Swagger UI (`/docs`)
- [x] Multi-tenant organization isolation and membership guards (`x-tenant-id`)
- [x] Dynamic Role-Based Access Control (RBAC) with decentralized permissions
- [x] Immutable compliance audit logging (actor, tenant, resource, diff)
- [x] Session tracking and multi-device revocation
- [x] Deterministic SHA-256 verification tokens (email verification & password reset)
- [x] Controlled, dual-identity user impersonation with time-boxing and guardrails
- [x] Background BullMQ workers with Bull-Board dashboard (`/admin/queues`)
- [x] Real-time WebSockets with Redis adapter & background worker emitter
- [ ] Integration test suite with Testcontainers (PostgreSQL & Redis)
- [ ] Infrastructure as Code (Terraform / AWS CDK)
- [ ] OpenTelemetry / Sentry distributed tracing and CloudWatch alarm dashboards
- [ ] AWS WAF rules in front of the Application Load Balancer
