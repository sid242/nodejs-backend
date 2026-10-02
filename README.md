# Node.js Scalable Foundation

Express + Postgres (Drizzle ORM) + Redis + BullMQ + Socket.IO + S3, containerised and deployable to AWS ECS Fargate.

## Architecture

```
                 ┌────────────── ALB / nginx ──────────────┐
 Browser ───────▶│  HTTPS + WebSocket (/socket.io)         │
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

Everything stateless lives in Redis/Postgres/S3, so API and worker replicas scale horizontally and independently.

Public API success responses use `{ success, message, data, requestId }`; errors use `{ error, requestId }`. Health and metrics endpoints keep their operational response formats.

## Quick start

```bash
cp .env.example .env            # set the two JWT secrets (32+ chars)
npm install                     # generates package-lock.json (commit it: Dockerfile uses `npm ci`)
docker compose up -d            # postgres, redis, minio (S3)
npm run db:generate             # only after changing files in src/db/schema/
npm run db:migrate
npm run dev                     # API       (terminal 1)
npm run dev:worker              # workers   (terminal 2)
```

Full containerised stack with load balancing: `docker compose --profile full up -d --build --scale api=3` then use http://localhost:8080.
(In that mode, presigned S3 URLs point at `minio:9000`, which your browser can't reach; use `npm run dev` for upload testing locally.)

## What's where

| Concern | Location | Notes |

| Database            | `src/db/schema/`, `src/config/db.js`                | Domain-organised Drizzle schema and PostgreSQL client                                    |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Config + validation | `src/config/env.js`                                 | Zod; app refuses to boot on bad env; explicit DB pool, HTTP timeout, and worker I/O caps |
| Logging             | `src/config/logger.js`, `middleware/http-logger.js` | Pino JSON, secrets redacted, `x-request-id` propagated                                   |
| Redis cache         | `src/lib/cache.js`                                  | cache-aside, stampede lock, fails open, SCAN-based invalidation                          |
| Rate limiting       | `middleware/rate-limit.js`                          | Redis store shared across replicas; global / auth / per-user                             |
| Auth                | `modules/auth`                                      | bcrypt, short JWT access token, rotating refresh token stored in Redis                   |
| S3 uploads          | `lib/s3.js`, `modules/files`                        | presigned POST with size/type limits; confirm step; presigned download                   |
| Queues              | `src/queues`                                        | BullMQ: retries + backoff, idempotent `jobId`, dashboard at `/admin/queues`              |
| Cron jobs           | `queues/workers/index.js`                           | BullMQ job schedulers (safe with many replicas)                                          |
| WebSockets          | `src/sockets`                                       | JWT handshake, Redis adapter, rooms, flood guard, worker->client emitter                 |
| Health              | `modules/health`                                    | `/health/live`, `/health/ready` (DB+Redis, 503 while draining)                           |
| Metrics             | `observability/metrics.js`                          | Prometheus `/metrics` (blocked at nginx)                                                 |
| Graceful shutdown   | `server.js`, `worker.js`                            | drain LB, close sockets/queues/DB; workers finish in-flight jobs                         |
| Docker/CI/CD        | `Dockerfile`, `.github/workflows`, `deploy/`        | one image, two roles; OIDC to AWS; migrations as a one-off task                          |

## Upload flow (S3)

1. `POST /api/v1/files/upload-url` `{filename, contentType}` -> `{fileId, upload:{url, fields}}`
2. Browser `POST`s `multipart/form-data` (`...fields`, then `file`) straight to S3
3. `POST /api/v1/files/:id/confirm` -> server verifies the object, enqueues processing job
4. Worker processes, then pushes `file:processed` to the user's socket
5. `GET /api/v1/files/:id/download-url` -> short-lived presigned GET

Bucket setup: block public access, enable default encryption, add a CORS rule allowing `POST` from your frontend origin, and a lifecycle rule to abort incomplete multipart uploads. Put CloudFront in front for public/read-heavy assets.

## AWS deployment (recommended shape)

- **Compute:** ECS Fargate, two services from the same image: `app-api` (behind ALB, target-tracking on CPU/requests) and `app-worker` (no LB; scale on queue depth via a custom CloudWatch metric).
- **Data:** RDS Postgres (+ RDS Proxy once replicas multiply), ElastiCache Redis (set `maxmemory-policy noeviction`; BullMQ needs it).
- **Network:** ALB in public subnets, tasks and data in private subnets, NAT/VPC endpoints for S3/ECR/Secrets Manager.
- **Secrets:** Secrets Manager injected through the task definition `secrets` block. No AWS keys in env: the **task role** grants S3/SES access.
- **Logs:** `awslogs` driver -> CloudWatch (structured JSON queryable in Logs Insights).
- **ALB:** idle timeout 60s (Node keep-alive is 65s), health check `/health/ready`, deregistration delay ~30s.
- **Task role (minimum):** `s3:GetObject/PutObject/DeleteObject` on `bucket/uploads/*`, `ses:SendEmail`.
- **Deploy:** push to `main` -> test -> build/push to ECR -> migrate -> rolling update with automatic rollback. Replace the `ACCOUNT_ID` / ARNs in `deploy/` and set repo secret `AWS_DEPLOY_ROLE_ARN` plus vars `PRIVATE_SUBNETS`, `APP_SECURITY_GROUP`.

## Scaling rules of thumb

- Never keep state in process memory (sessions, rooms, rate limits all live in Redis).
- Pool math: `DB_POOL_MAX x (API replicas + worker replicas)` must stay under Postgres `max_connections`; budget migration tasks too.
- Keep request paths fast: anything slow or flaky (email, image work, third parties) goes through a queue.
- Make jobs idempotent (they will be retried); use `jobId` for dedupe.
- Add DB indexes for every list/filter query; paginate everything.
- Use a separate Redis for queues vs cache if cache eviction ever becomes necessary.

## Production checklist / what to add next

- [ ] Sentry or OpenTelemetry tracing; Prometheus/Grafana or CloudWatch alarms (5xx rate, p95 latency, queue depth, failed jobs)
- [ ] OpenAPI/Swagger docs (`zod-to-openapi`) and API versioning policy
- [ ] Integration tests (Testcontainers for Postgres/Redis) on top of the included unit tests
- [ ] Infrastructure as code (Terraform/CDK) for everything described above
- [ ] WAF in front of the ALB; dependency scanning (Dependabot/Trivy); `npm audit` in CI
- [ ] Email verification, password reset, RBAC beyond `USER/ADMIN`, audit log
- [ ] Migrate to TypeScript once the shape settles (structure maps 1:1)
- [ ] Backups + restore drill (RDS PITR), Redis persistence (AOF) if queued jobs must survive restarts
