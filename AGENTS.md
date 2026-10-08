# Node.js Scalable Foundation — AI Agent Instructions

This repository is a production-ready, scalable Node.js & TypeScript backend foundation built with **Express**, **PostgreSQL (Drizzle ORM)**, **Redis**, **BullMQ**, **Socket.IO**, and **AWS S3 / SES**, containerized and architected for independent horizontal scaling on AWS ECS Fargate.

---

## 1. System Architecture & Core Principles

- **Stateless API Replicas**: No in-memory state or sessions. All authentication state (refresh tokens), rate limiting counters, WebSocket adapter sync, and caching live in Redis or Postgres.
- **Separate Worker Processes**: Background jobs, email delivery, media processing, and scheduled cron jobs run in a separate process (`src/worker.ts`) to decouple CPU/IO heavy tasks from the API request loop.
- **Strict Response Envelopes**:
  - Success: `{ success: true, message: string, data: any, meta?: any, requestId: string }`
  - Error: `{ error: { code: string, message: string, details?: any }, requestId: string }`
- **DB Connection Pool Budget**: Postgres pool limits (`DB_POOL_MAX`) must be strictly respected. Total connections across `(API Replicas + Worker Replicas) * DB_POOL_MAX` must remain under Postgres `max_connections`.
- **Idempotent Background Jobs**: Every BullMQ job must be safe to retry. Use deterministic `jobId` deduplication where appropriate.

---

## 2. Directory Structure & Layering

```
node-scalable-foundation/
├── .agents/                      # Antigravity AI Customizations (Rules & Skills)
├── deploy/                       # AWS ECS Fargate task definitions (api, worker)
├── drizzle/                      # Generated SQL migration files (Drizzle Kit)
├── nginx/                        # Local load balancer & reverse proxy config
├── src/
│   ├── app.ts                    # Express app initialization, middleware stack
│   ├── server.ts                 # API HTTP & WebSocket server entrypoint
│   ├── worker.ts                 # Background worker process entrypoint
│   ├── routes.ts                 # Central /api/v1 router aggregation
│   ├── types/                    # Express global type augmentations (Request)
│   │   └── express.d.ts
│   ├── config/                   # Environment (Zod), DB, Redis, Pino Logger
│   │   ├── env.ts                # Strict environment variable validation
│   │   ├── db.ts                 # Drizzle Postgres client & pool
│   │   ├── redis.ts              # ioredis client factory & lifecycle management
│   │   └── logger.ts             # Structured JSON Pino logger with redactions
│   ├── db/                       # Database schema & migration runner
│   │   ├── migrate.ts            # Drizzle migration executor
│   │   └── schema/               # Domain-specific Drizzle schema definitions
│   │       ├── enums.ts          # Shared PostgreSQL enums
│   │       ├── users.ts          # Users table & public projections
│   │       ├── files.ts          # Files table & status enums
│   │       └── index.ts          # Unified schema exports
│   ├── docs/                     # OpenAPI 3.0 specs & Swagger UI (/docs)
│   │   ├── index.ts              # Swagger UI router & /openapi.json endpoint
│   │   ├── openapi.ts            # Root OpenAPI document generator & aggregator
│   │   ├── helpers.ts            # Security schemes & response envelope helpers
│   │   └── routes/               # Modular OpenAPI route specifications
│   │       ├── health.docs.ts
│   │       ├── auth.docs.ts
│   │       ├── users.docs.ts
│   │       └── files.docs.ts
│   ├── lib/                      # Core utility libraries
│   │   ├── async-handler.ts      # Express async route wrapper
│   │   ├── cache.ts              # Redis cache-aside with mutex/stampede lock
│   │   ├── errors.ts             # AppError subclass hierarchy
│   │   ├── mailer.ts             # AWS SES v2 client wrapper
│   │   ├── responses.ts          # AppResponse standard JSON formatter
│   │   ├── s3.ts                 # AWS S3 presigned POST & GET generator
│   │   └── utils.ts              # Generic helper utilities
│   ├── middleware/               # Express middleware
│   │   ├── auth.ts               # JWT authentication & RBAC guards
│   │   ├── error.ts              # Centralized error handler & 404 handler
│   │   ├── http-logger.ts        # Pino HTTP logger with request ID propagation
│   │   ├── rate-limit.ts         # Redis-backed rate limiters (global, auth, user)
│   │   └── validate.ts           # Zod request validation middleware
│   ├── modules/                  # Domain-driven feature modules
│   │   ├── auth/                 # Authentication, JWT, refresh tokens
│   │   ├── files/                # S3 uploads, confirmation, downloads
│   │   ├── health/               # /health/live, /health/ready probes
│   │   └── users/                # User profile & administration
│   ├── observability/            # Prometheus metrics (/metrics)
│   ├── queues/                   # BullMQ queue definitions & workers
│   │   ├── index.ts              # Queue definitions (email, file, maintenance)
│   │   ├── bull-board.ts         # Admin dashboard router
│   │   └── workers/              # Job processors & cron schedulers
│   └── sockets/                  # Real-time WebSockets (Socket.IO + Redis adapter)
│       ├── index.ts              # Socket.IO server, JWT handshake, room handlers
│       └── emitter.ts            # Redis emitter for worker -> client notifications
└── test/                         # Unit & integration tests (tsx --test)
```

---

## 3. Key Development Conventions

### 3.1 Module Blueprint (4-Layer Pattern + DTOs)

Every new business domain should be placed in `src/modules/<domain>/`:

1. **`<domain>.dto.ts`**: Defines Zod request schemas (body, query, params) and data contracts.
2. **`<domain>.routes.ts`**: Defines routes, applies auth guards (`requireAuth`, `requireRole`), attaches rate limiters, validates inputs via `validate({ body, query, params })`, and routes to the controller.
3. **`<domain>.controller.ts`**: HTTP layer wrapped in `asyncHandler`. Extracts validated params/body/query, invokes the service layer, and formats output with `AppResponse.ok(data)` or `AppResponse.created(data)`.
4. **`<domain>.service.ts`**: Contains business logic, orchestrating workflows, hashing, caching via `cache.wrap()`, BullMQ background queue dispatch, and error throwing via `AppError.*`.
5. **`<domain>.repository.ts`**: Pure database data-access layer containing Drizzle ORM queries (`db.select()`, `db.insert()`, `db.update()`, `db.delete()`).
6. **Database Schema**: Tables added to `src/db/schema/<domain>.ts` and re-exported in `src/db/schema/index.ts`.
7. **Registration**: Mount router in `src/routes.ts` under `/api/v1/<domain>`.

### 3.2 Error Handling

- Never throw generic `Error` for client-facing issues. Use `AppError`:
  - `AppError.badRequest('Invalid parameter', details)` (400)
  - `AppError.unauthorized('Invalid or missing token')` (401)
  - `AppError.forbidden('Insufficient permissions')` (403)
  - `AppError.notFound('Resource not found')` (404)
  - `AppError.conflict('Resource already exists')` (409)
- All unhandled exceptions are caught by `src/middleware/error.ts`, logged with Pino, and returned as `{ error: { code, message, details }, requestId }`.

### 3.3 Database & Migrations (Drizzle ORM)

- Schemas defined with `pgTable` in `src/db/schema/`.
- Always export public projection shapes to prevent leaking sensitive fields (e.g. `passwordHash`).
- Migration commands:
  - `npm run db:generate`: Generate SQL migration files in `drizzle/` after schema changes.
  - `npm run db:check`: Check for schema consistency/conflicts.
  - `npm run db:migrate`: Apply pending migrations to PostgreSQL.

### 3.4 Caching Strategy

- Use `cache.wrap(key, ttlSeconds, fetchFn)` from `src/lib/cache.ts`.
- It includes a distributed mutex lock to prevent cache stampedes under high concurrency.
- Invalidate cache on mutations using `cache.del(key)` or `cache.delPattern(pattern)`.

### 3.5 Background Queues & WebSockets

- Background queues are defined in `src/queues/index.ts`.
- Worker processors are registered in `src/queues/workers/index.ts`.
- Workers running in `src/worker.ts` can notify connected WebSocket clients in real-time using `emitToUser(userId, event, payload)` or `emitToRoom(room, event, payload)` from `src/sockets/emitter.ts`.

---

## 4. Useful Commands

| Command                | Description                                                          |
| :--------------------- | :------------------------------------------------------------------- |
| `npm run dev`          | Run API server with file watch (`tsx watch --env-file=.env`)         |
| `npm run dev:worker`   | Run Background Worker with file watch (`tsx watch --env-file=.env`)  |
| `npm run typecheck`    | Run TypeScript compiler type checking (`tsc --noEmit`)                |
| `npm test`             | Run test suites with tsx test runner (`tsx --test`)                  |
| `npm run lint`         | Check linting with ESLint                                            |
| `npm run lint:fix`     | Fix lint issues automatically                                        |
| `npm run format`       | Format files with Prettier                                           |
| `npm run db:generate`  | Generate Drizzle migrations from schema changes                      |
| `npm run db:migrate`   | Execute pending Drizzle migrations                                   |
| `docker compose up -d` | Start local Postgres, Redis, and MinIO containers                    |
