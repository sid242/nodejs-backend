# Architecture & Design Rules

## 1. Process Separation & Horizontal Scaling

- The application is split into two independently deployable process types sharing the same container image:
  - **API Service (`src/server.ts`)**: Runs Express HTTP server and Socket.IO WebSocket server. Scaled based on HTTP traffic and CPU/memory.
  - **Worker Service (`src/worker.ts`)**: Runs BullMQ worker instances and cron schedulers. Scaled based on Redis queue depth.
- No direct in-memory communication between processes; all shared state and messaging must go through **PostgreSQL** or **Redis** (via BullMQ queues or `@socket.io/redis-emitter`).

## 2. Statelessness Principle

- Never store session data, authentication state, or client rooms in Node.js process memory.
- Sockets use the `@socket.io/redis-adapter` so events and room subscriptions work across all API replicas.
- Auth refresh tokens are tracked with rotating jtis in Redis (`src/modules/auth/tokens.ts`).
- Rate limiting counters are stored in Redis (`rate-limit-redis`).

## 3. 4-Layer Domain Architecture + DTOs

All domain modules (`auth`, `billing`, `files`, `health`, `plans`, `platform`, `tenants`, `users`) live under `src/modules/<domain>/` following strict separation of concerns:

- **DTO Layer (`*.dto.ts`)**:
  - Request and query validation schemas defined with Zod.
- **Routes Layer (`*.routes.ts`)**:
  - Attaches auth guards (`requireAuth`, `requireTenant`, `requirePlatformAuth`), permission checks (`requirePermission`, `requirePlatformPermission`), and rate limiters.
  - Validates request payload/query/params using `validate({ body, query, params })`.
  - Dispatches to controller methods.
- **Controller Layer (`*.controller.ts`)**:
  - Express handlers wrapped in `asyncHandler`. Extracts validated inputs from `req.valid`.
  - Calls service layer methods and returns standard `AppResponse.ok()` or `AppResponse.created()`.
- **Service Layer (`*.service.ts`)**:
  - Implements business logic, transaction workflows, and quota verifications.
  - Orchestrates cache lookup/invalidation with `cache.wrap()` and `cache.delByPrefix()`.
  - Dispatches background jobs to BullMQ queues (`emailQueue`, `fileQueue`, etc.).
  - Throws typed `AppError` subclasses.
- **Repository Layer (`*.repository.ts`)**:
  - Dedicated database data-access queries using Drizzle ORM (`db`).
- **Database / Schema Layer (`src/db/schema/`)**:
  - Declarative PostgreSQL schema definitions using `drizzle-orm/pg-core`.
  - Schema files are re-exported in `src/db/schema/index.ts` with extensionless module paths.
