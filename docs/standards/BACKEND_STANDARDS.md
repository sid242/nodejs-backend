# Backend Engineering Standards — Node.js 24+, TypeScript ESM, Express, PostgreSQL, Drizzle

Repository: `sid242/nodejs-backend`

## 1. Runtime and module system

- Respect the declared Node engine and verify the actual runtime in CI and production images.
- Keep ESM conventions consistent (`"type": "module"`).
- Confirm TypeScript module resolution, build output and Node runtime behavior agree.
- Use Node built-ins instead of unnecessary third-party packages.
- Read current Node.js and installed framework/ORM docs before using APIs.
- Do not mix CommonJS and ESM patterns without a compatibility reason.

## 2. Layering and module boundaries

Use the existing module/feature architecture. Keep responsibilities clear:
- Routes/controllers: HTTP concerns, parse validated request, call application service, map result to response.
- Middleware: authentication, tenant resolution, rate limits, request context.
- Services/use cases: business rules and orchestration.
- Repositories: persistence and query composition.
- Schemas/DTOs: runtime input/output validation.
- Infrastructure adapters: Redis, email, S3, Razorpay, sockets, queues.
- Domain types/rules: framework-independent concepts where worthwhile.

Avoid controllers with business logic and repositories that decide HTTP status codes. Avoid circular imports and giant service classes.

## 3. TypeScript and runtime validation

- `strict: true`; assess `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables` and other strict options.
- Enable `@typescript-eslint/no-explicit-any: error`. The currently visible backend ESLint config disables this rule; remove that exception after a measured cleanup.
- Use `unknown` for caught errors and untrusted values, then narrow.
- Validate every external input with Zod or the repository's approved schema layer: body, params, query, headers, env, webhooks and third-party responses.
- TypeScript types do not validate HTTP input at runtime.
- Avoid `as` casts for request objects and DB results; use validated types and narrow helpers.
- Do not use `!` to bypass missing values.
- Avoid broad declaration merging for Express Request when a typed request context or narrow augmentation is clearer.
- Keep API DTOs distinct from DB row types where exposing DB shape would leak internal fields.

## 4. Express

- Align Express runtime version and `@types/express` major version. The visible package manifest currently declares Express 4.x and `@types/express` 5.x; verify lockfile and compatibility before changing.
- Use typed route params/body/query after runtime validation.
- Keep middleware order explicit: request ID/logging, security headers, body limits/parsers, CORS, rate limits, routes, 404, centralized error handler (adapt to actual architecture).
- Async route failures must reach centralized error middleware. Do not rely on behavior that differs between Express 4 and 5.
- Do not pass arbitrary client-controlled values into SQL identifiers, filesystem paths or redirect URLs.
- Limit request body size and upload metadata size.
- Return consistent status codes and stable error envelopes.
- Do not leak internal errors or stack traces in production.

## 5. Database and Drizzle ORM

- Use typed Drizzle schema as the source for query types; avoid duplicate handwritten row types.
- Keep schema, migration SQL and generated journal synchronized.
- Review generated SQL before applying migrations.
- Use explicit transactions for multi-step invariants.
- Keep transactions short; do not perform slow network calls inside DB transactions.
- Use parameterized Drizzle expressions; never interpolate untrusted values into raw SQL.
- Avoid N+1 queries; select only required columns and add indexes based on query plans.
- Add database constraints for invariants: unique, FK, check, not-null where appropriate.
- Use database-level uniqueness/idempotency for race-prone operations.
- Use cursor pagination for large/changing datasets where suitable; use stable deterministic ordering.
- Avoid unbounded selects and unbounded `IN` lists.
- Do not use `drizzle-kit push` as a production deployment shortcut. Generate/review migrations and apply through controlled migration workflow.
- Follow expand-contract migrations: deploy additive schema first, backfill, deploy compatible code, then remove old schema in a later release.
- Never edit already-applied migration history without a deliberate repair plan.

## 6. Multi-tenancy and authorization

- Resolve tenant context from authenticated, validated, membership-authorized context; never trust a tenant ID header alone.
- Ensure every tenant-owned query uses the approved tenant database/repository abstraction.
- Keep platform data and tenant-owned data boundaries explicit.
- Verify RLS context is established and cleared safely for pooled connections and transactions.
- Never allow a missing tenant context to fall back to an unscoped query.
- Test cross-tenant access for read, write, list, search, export, background jobs and sockets.
- Enforce authorization on backend routes/services, not only in frontend navigation.
- Separate authentication, tenant membership, role permission, policy/attribute evaluation and plan entitlement.
- Use default deny for protected actions.
- Audit sensitive mutations and authorization changes.

## 7. Redis and caching

- Redis is not the source of truth for durable business data.
- Define key namespaces including tenant/user/resource scope.
- Define TTL and invalidation for every cache family.
- Avoid caching authorization decisions without a version/invalidation strategy.
- Handle Redis unavailable/timeout conditions explicitly.
- Use bounded SCAN patterns; do not use KEYS in production.
- Use distributed locks only where required and implement lease expiry/ownership-safe release.
- Prevent cache stampedes with bounded strategies.
- Do not cache sensitive data longer than necessary.

## 8. BullMQ and background jobs

- Every job handler must be idempotent.
- Define attempts, backoff, timeout, concurrency and retention.
- Separate retryable from permanent errors.
- Validate job payloads at execution time; queued payloads are untrusted persisted input.
- Propagate tenant/actor context explicitly and safely.
- Avoid putting secrets or large binary data in job payloads.
- Handle duplicate delivery and out-of-order processing.
- Monitor failed/stalled jobs and provide safe replay/dead-letter operations.
- Gracefully stop accepting jobs and wait for in-flight work during shutdown.
- Do not assume a scheduled job runs exactly once across replicas.

## 9. External integrations and webhooks

- Wrap providers behind typed adapters.
- Set connection/request timeouts.
- Retry only transient failures.
- Verify webhook signatures using exact raw bytes and provider requirements before parsing.
- Deduplicate webhook events using provider event IDs and database uniqueness.
- Handle out-of-order events and idempotent state transitions.
- Never activate paid entitlements based solely on a browser callback.
- Redact credentials and personal data from logs.
- Validate provider responses and map them into internal domain events.

## 10. Security

- Use Helmet and a deliberate CORS allowlist.
- Apply route-specific rate limits, especially auth, password reset, uploads, search and expensive operations.
- Use secure, HttpOnly, SameSite cookies where cookie auth is used.
- Define access/refresh token rotation, revocation and replay detection.
- Prefer one JWT library consistently unless multiple are demonstrably required. The visible manifest contains both `jose` and `jsonwebtoken`; inspect usage and standardize if safe.
- Password hashing should use a currently supported, appropriately configured algorithm/work factor; review bcrypt compatibility and consider Argon2id only through a planned migration.
- Prevent SSRF in URL-fetching features.
- Validate upload size, MIME, extension and content; do not trust browser MIME alone.
- Use least-privilege DB/service credentials.
- Keep secrets in a secret manager or environment injection; never store plaintext provider secrets in tenant rows.
- Ensure logs and Sentry scrub authorization headers, cookies, tokens, passwords, payment data and sensitive PII.

## 11. Observability and operations

- Propagate request ID/correlation ID across HTTP, queues and provider calls.
- Use structured Pino logs with stable fields and redaction.
- Do not log the same error at every layer.
- Metrics labels must have bounded cardinality; never use user IDs, raw URLs or tenant IDs as unbounded labels.
- Distinguish liveness from readiness.
- Readiness should fail when critical dependencies prevent serving traffic.
- Graceful shutdown: stop accepting requests, drain sockets, stop workers, close Redis and DB pools.
- Add timeouts and health checks for external dependencies.
- Document operational runbooks for queue failure, migration failure, Redis outage and DB pool exhaustion.

## 12. Backend tests

- Unit-test pure domain functions and validation.
- Integration-test repositories against real PostgreSQL/Redis test services where practical.
- Test tenant isolation and RLS with separate tenant identities.
- Test transactions and concurrent duplicate operations.
- Test authorization deny paths, not only success.
- Test webhook signatures, replay, duplicate events and out-of-order delivery.
- Test queue retries, idempotency and graceful shutdown.
- Test socket authentication, tenant rooms and authorization.
- Avoid tests that depend on production data or nondeterministic wall-clock behavior.
