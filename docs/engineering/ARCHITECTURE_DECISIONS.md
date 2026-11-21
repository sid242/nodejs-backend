# Architecture Decisions & Invariants — Backend Repository

**Repository:** `sid242/nodejs-backend` (`node-scalable-foundation`)  

---

## 1. Architectural Invariants

### 1.1 Stateless API & Separated Workers
- API servers (`src/server.ts`) handle HTTP and real-time Socket.IO connections.
- Heavy IO, email delivery, and background tasks run exclusively in worker processes (`src/worker.ts`) via BullMQ.
- State is never held in memory; all shared state lives in PostgreSQL or Redis.

### 1.2 4-Layer Module Architecture
Every domain feature in `src/modules/<domain>/` adheres strictly to:
1. `<domain>.dto.ts`: Zod schema validation for inputs.
2. `<domain>.routes.ts`: Route declarations with attached rate limits and auth guards.
3. `<domain>.controller.ts`: Request parsing and response formatting (`AppResponse`).
4. `<domain>.service.ts`: Business logic and cache orchestration (`cache.wrap`).
5. `<domain>.repository.ts`: Database queries (`tenantDb()` / `db`).

### 1.3 Tenant Isolation & Database Routing
- Primary cluster hosts shared platform and metadata tables.
- Tenant-specific data is queried via `tenantDb(tenantId)` with PostgreSQL Row-Level Security (RLS) active.
- Unscoped queries for tenant-owned tables are prohibited.

### 1.4 Expand-Contract Database Migrations
- Step 1: Add new nullable columns or tables (`npm run db:generate`, apply migration).
- Step 2: Deploy code interacting with new schema structures.
- Step 3: Deprecate and drop legacy columns in a subsequent release.
