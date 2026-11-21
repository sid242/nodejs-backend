# Dependency Audit & Modernization Policy — Backend Repository

**Repository:** `sid242/nodejs-backend` (`node-scalable-foundation`)  
**Audit Date:** 21 November 2026  

---

## 1. Key Dependency Analysis & Review Candidates

| Package | Declared Version | Category | Assessment & Action Plan |
| :--- | :--- | :--- | :--- |
| `express` | `^4.21.2` | Core Web Framework | Stable Express 4 runtime. |
| `@types/express` | `^5.0.6` | TypeScript Definitions | **Mismatch**: Types are for Express 5 while runtime is Express 4. Align `@types/express` to `^4.17.21` or evaluate full Express 5 upgrade roadmap. |
| `drizzle-orm` | `^0.45.3` | Relational ORM | Current and stable. Compatible with `drizzle-kit ^0.31.11` and `postgres ^3.4.9`. |
| `ioredis` | `^5.4.2` | Redis Client | Stable. Coordinates BullMQ and Socket.IO Redis adapter. |
| `bullmq` | `^5.34.0` | Background Queues | Modern BullMQ v5 with worker idempotency. |
| `@bull-board/express` | `^5.23.0` | Queue Dashboard | Stable with BullMQ v5. |
| `jose` | `^6.2.17` | JWT / Cryptography | Modern zero-dependency JWT/JWS/JWE library. |
| `jsonwebtoken` | `^9.0.2` | Legacy JWT | Redundant with `jose`. Plan phase-out to eliminate duplicate cryptographic dependencies. |
| `@aws-sdk/*` | `^3.700.0` | Cloud Infrastructure | Coordinated family for S3 and SES v2. Keep lockfile versions aligned across AWS SDK packages. |
| `@sentry/node` | `^8.55.2` | Observability | Sentry SDK v8 with OpenTelemetry instrumentation. |
| `pino` | `^9.5.0` | Structured Logger | High-performance JSON logging with request ID propagation. |
| `zod` | `^3.24.1` | Schema Validation | Synchronized with `@asteasolutions/zod-to-openapi ^7.3.4`. |

---

## 2. Upgrade & Verification Guidelines

1. **Lockfile as Source of Truth**: All dependency modifications must be installed via `npm` to keep `package-lock.json` deterministic.
2. **Coordinated Upgrades**: AWS SDK packages and Drizzle packages must be updated as coordinated sets.
3. **No Breaking Changes Without Proof**: Run `npm run typecheck`, `npm run lint`, and tests before accepting any dependency version change.
