# Code Quality & Engineering Standards — Backend Rule

This rule governs all code changes in `node-scalable-foundation`. All agents and developers must strictly follow these engineering standards.

## 1. Non-Negotiable Core Principles

1. **Audit Before Modifying**: Never make speculative or blind edits. Understand existing patterns, types, and invariants before changing code.
2. **Strict Type Safety — Zero `any`**:
   - Never introduce `any` or `as any`.
   - Use `unknown` at untrusted boundaries (network inputs, external SDK returns, parsed JSON) and narrow via Zod schemas or type guards.
   - Do not use `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` or `eslint-disable` to suppress type or lint errors without an documented invariant.
   - Avoid non-null assertions (`!`). Prove existence using guard clauses.
3. **No Swallowing Errors**:
   - Never write empty catch blocks (`try { ... } catch {}`). Always handle, log with Pino, wrap in `AppError`, or explicitly annotate ignored exceptions (`catch (_err) { /* explanation */ }`).
   - All async route errors must propagate to the centralized error middleware via `asyncHandler`.
4. **Control Flow Discipline**:
   - Use **guard clauses** for preconditions and early exits to prevent pyramid code.
   - Use **lookup objects** (`Record<Key, Value> satisfies ...`) for static mapping tables instead of long `if/else` or repetitive `switch`.
   - Use **`switch` with exhaustive checks** (`assertNever`) for finite discriminated unions.
   - Avoid nested ternaries.
5. **Truthiness & Null Safety**:
   - Use `??` (nullish coalescing) when defaulting values where `0`, `false`, or `""` are valid.
   - Use `||` only when every falsy value intentionally triggers fallback.
   - Use optional chaining (`?.`) only on genuinely optional paths, not to mask missing required data.
6. **Defense-in-Depth Security & Multi-Tenancy**:
   - Every tenant-scoped database query **MUST** use `tenantDb()` and include `"tenantId"` filter / RLS context.
   - Never trust client-provided tenant headers without authentication and validated tenant membership.
   - Authorization checks must occur server-side in controllers/services, not merely in client UI routes.
   - Secrets, tokens, hashes, and sensitive PII must never be logged or returned in error payloads.
7. **Database & Drizzle ORM Hygiene**:
   - Drizzle schema is the single source of truth for DB types.
   - Always export public projection shapes to prevent accidental credential leakage (e.g. `passwordHash`).
   - Backward-compatible migrations only (Expand → Deploy → Contract). Never drop active columns in the same release.
8. **Redis & Background Jobs (BullMQ)**:
   - Redis is a cache/coordination layer, not durable source of truth. Always configure TTL and namespaces.
   - All BullMQ job handlers must be idempotent and safely retryable. Validate payloads at execution time.
9. **Verification Gate**:
   - After any modification, run `npm run typecheck`, `npm run lint`, and relevant tests. Never declare completion without green command outputs.
