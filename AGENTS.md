# Node.js Scalable Foundation — AI Agent Instructions

This repository is a production-ready, scalable Node.js backend foundation built with **Express**, **PostgreSQL (Drizzle ORM)**, **Redis**, **BullMQ**, **Socket.IO**, and **AWS S3 / SES**, containerized and architected for independent horizontal scaling on AWS ECS Fargate.

---

## 1. System Architecture & Core Principles

- **Stateless API Replicas**: No in-memory state or sessions. All authentication state (refresh tokens), rate limiting counters, WebSocket adapter sync, and caching live in Redis or Postgres.
- **Separate Worker Processes**: Background jobs, email delivery, media processing, and scheduled cron jobs run in a separate process (`src/worker.js`) to decouple CPU/IO heavy tasks from the API request loop.
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
│   ├── app.js                    # Express app initialization, middleware stack
│   ├── server.js                 # API HTTP & WebSocket server entrypoint
│   ├── worker.js                 # Background worker process entrypoint
│   ├── routes.js                 # Central /api/v1 router aggregation
│   ├── config/                   # Environment (Zod), DB, Redis, Pino Logger
│   │   ├── env.js                # Strict environment variable validation
│   │   ├── db.js                 # Drizzle Postgres client & pool
│   │   ├── redis.js              # ioredis client factory & lifecycle management
│   │   └── logger.js             # Structured JSON Pino logger with redactions
│   ├── db/                       # Database schema & migration runner
│   │   ├── migrate.js            # Drizzle migration executor
│   │   └── schema/               # Domain-specific Drizzle schema definitions
│   │       ├── enums.js          # Shared PostgreSQL enums
│   │       ├── users.js          # Users table & public projections
│   │       ├── files.js          # Files table & status enums
│   │       └── index.js          # Unified schema exports
│   ├── docs/                     # OpenAPI 3.0 specs & Swagger UI (/docs)
│   │   ├── index.js              # Swagger UI router & /openapi.json endpoint
│   │   ├── openapi.js            # Root OpenAPI document generator & aggregator
│   │   ├── helpers.js            # Security schemes & response envelope helpers
│   │   └── routes/               # Modular OpenAPI route specifications
│   │       ├── health.docs.js
│   │       ├── auth.docs.js
│   │       ├── users.docs.js
│   │       └── files.docs.js
│   ├── lib/                      # Core utility libraries
│   │   ├── async-handler.js      # Express async route wrapper
│   │   ├── cache.js              # Redis cache-aside with mutex/stampede lock
│   │   ├── errors.js             # AppError subclass hierarchy
│   │   ├── mailer.js             # AWS SES v2 client wrapper
│   │   ├── responses.js          # AppResponse standard JSON formatter
│   │   ├── s3.js                 # AWS S3 presigned POST & GET generator
│   │   └── utils.js              # Generic helper utilities
│   ├── middleware/               # Express middleware
│   │   ├── auth.js               # JWT authentication & RBAC guards
│   │   ├── error.js              # Centralized error handler & 404 handler
│   │   ├── http-logger.js        # Pino HTTP logger with request ID propagation
│   │   ├── rate-limit.js         # Redis-backed rate limiters (global, auth, user)
│   │   └── validate.js           # Zod request validation middleware
│   ├── modules/                  # Domain-driven feature modules
│   │   ├── auth/                 # Authentication, JWT, refresh tokens
│   │   ├── files/                # S3 uploads, confirmation, downloads
│   │   ├── health/               # /health/live, /health/ready probes
│   │   └── users/                # User profile & administration
│   ├── observability/            # Prometheus metrics (/metrics)
│   ├── queues/                   # BullMQ queue definitions & workers
│   │   ├── index.js              # Queue definitions (email, file, maintenance)
│   │   ├── bull-board.js         # Admin dashboard router
│   │   └── workers/              # Job processors & cron schedulers
│   └── sockets/                  # Real-time WebSockets (Socket.IO + Redis adapter)
│       ├── index.js              # Socket.IO server, JWT handshake, room handlers
│       └── emitter.js            # Redis emitter for worker -> client notifications
└── test/                         # Unit & integration tests (Node.js test runner)
```

---

## 3. Key Development Conventions

### 3.1 Module Blueprint (4-Layer Pattern + DTOs)

Every new business domain should be placed in `src/modules/<domain>/`:

1. **`<domain>.dto.js`**: Defines Zod request schemas (body, query, params) and data contracts.
2. **`<domain>.routes.js`**: Defines routes, applies auth guards (`requireAuth`, `requireRole`), attaches rate limiters, validates inputs via `validate({ body, query, params })`, and routes to the controller.
3. **`<domain>.controller.js`**: HTTP layer wrapped in `asyncHandler`. Extracts validated params/body/query, invokes the service layer, and formats output with `AppResponse.ok(data)` or `AppResponse.created(data)`.
4. **`<domain>.service.js`**: Contains business logic, orchestrating workflows, hashing, caching via `cache.wrap()`, BullMQ background queue dispatch, and error throwing via `AppError.*`.
5. **`<domain>.repository.js`**: Pure database data-access layer containing Drizzle ORM queries (`db.select()`, `db.insert()`, `db.update()`, `db.delete()`).
6. **Database Schema**: Tables added to `src/db/schema/<domain>.js` and re-exported in `src/db/schema/index.js`.
7. **Registration**: Mount router in `src/routes.js` under `/api/v1/<domain>`.

### 3.2 Error Handling

- Never throw generic `Error` for client-facing issues. Use `AppError`:
  - `AppError.badRequest('Invalid parameter', details)` (400)
  - `AppError.unauthorized('Invalid or missing token')` (401)
  - `AppError.forbidden('Insufficient permissions')` (403)
  - `AppError.notFound('Resource not found')` (404)
  - `AppError.conflict('Resource already exists')` (409)
- All unhandled exceptions are caught by `src/middleware/error.js`, logged with Pino, and returned as `{ error: { code, message, details }, requestId }`.

### 3.3 Database & Migrations (Drizzle ORM)

- Schemas defined with `pgTable` in `src/db/schema/`.
- Always export public projection shapes to prevent leaking sensitive fields (e.g. `passwordHash`).
- Migration commands:
  - `npm run db:generate`: Generate SQL migration files in `drizzle/` after schema changes.
  - `npm run db:check`: Check for schema consistency/conflicts.
  - `npm run db:migrate`: Apply pending migrations to PostgreSQL.

### 3.4 Caching Strategy

- Use `cache.wrap(key, ttlSeconds, fetchFn)` from `src/lib/cache.js`.
- It includes a distributed mutex lock to prevent cache stampedes under high concurrency.
- Invalidate cache on mutations using `cache.del(key)` or `cache.delPattern(pattern)`.

### 3.5 Background Queues & WebSockets

- Background queues are defined in `src/queues/index.js`.
- Worker processors are registered in `src/queues/workers/index.js`.
- Workers running in `src/worker.js` can notify connected WebSocket clients in real-time using `emitToUser(userId, event, payload)` or `emitToRoom(room, event, payload)` from `src/sockets/emitter.js`.

---

## 4. Useful Commands

| Command                | Description                                                  |
| :--------------------- | :----------------------------------------------------------- |
| `npm run dev`          | Run API server with file watch (`--watch --env-file=.env`)   |
| `npm run dev:worker`   | Run Background Worker with file watch                        |
| `npm test`             | Run tests using Node.js built-in test runner (`node --test`) |
| `npm run lint`         | Check linting with ESLint                                    |
| `npm run lint:fix`     | Fix lint issues automatically                                |
| `npm run format`       | Format files with Prettier                                   |
| `npm run db:generate`  | Generate Drizzle migrations from schema changes              |
| `npm run db:migrate`   | Execute pending Drizzle migrations                           |
| `docker compose up -d` | Start local Postgres, Redis, and MinIO containers            |
