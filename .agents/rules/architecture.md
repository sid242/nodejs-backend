# Architecture & Design Rules

## 1. Process Separation & Horizontal Scaling

- The application is split into two independently deployable process types sharing the same container image:
  - **API Service (`src/server.js`)**: Runs Express HTTP server and Socket.IO WebSocket server. Scaled based on HTTP traffic and CPU/memory.
  - **Worker Service (`src/worker.js`)**: Runs BullMQ worker instances and cron schedulers. Scaled based on Redis queue depth.
- No direct in-memory communication between processes; all shared state and messaging must go through **PostgreSQL** or **Redis** (via BullMQ queues or `@socket.io/redis-emitter`).

## 2. Statelessness Principle

- Never store session data, authentication state, or client rooms in Node.js process memory.
- Sockets use the `@socket.io/redis-adapter` so events and room subscriptions work across all API replicas.
- Auth refresh tokens are tracked with rotating jtis in Redis (`src/modules/auth/tokens.js`).
- Rate limiting counters are stored in Redis (`rate-limit-redis`).

## 3. 3-Tier Domain Architecture

All new features should be implemented under `src/modules/<domain>/` following strict separation of concerns:

- **Routes Layer (`*.routes.js`)**:
  - Validates request payload/query/params using Zod.
  - Applies auth & permission middlewares (`requireAuth`, `requireRole`).
  - Delegates execution to the service layer.
  - Formats response with `AppResponse` envelope.
  - Never directly executes database queries or third-party API calls.
- **Service Layer (`*.service.js`)**:
  - Implements business logic, transaction handling, and validations.
  - Reads and writes to the database via Drizzle ORM (`db`).
  - Implements caching with `cache.wrap()` where appropriate.
  - Dispatches asynchronous jobs to BullMQ queues (`emailQueue`, `fileQueue`, etc.).
  - Throws typed `AppError` instances for known failure scenarios.
- **Database / Schema Layer (`src/db/schema/`)**:
  - Declarative PostgreSQL schema definitions using `drizzle-orm/pg-core`.
  - Schema files are re-exported in `src/db/schema/index.js`.
