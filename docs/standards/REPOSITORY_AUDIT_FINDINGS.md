# Repository Audit Findings — Frontend & Backend

**Review date:** 18 November 2026  
**Repositories:** `sid242/nextjs-frontend`, `sid242/nodejs-backend`  
**Branch visible during review:** `main`

## 1. Scope and confidence

Reviewed public GitHub repository pages, root README files, package manifests, ESLint configurations, and repository `AGENTS.md` instructions. This is a configuration/documentation-level remote review, not a complete local source-code audit. No dependency installation, tests, builds, database migrations, or runtime behavior were executed in this review.

Antigravity must verify all observations against the current checked-out commit and lockfile before acting. Repository content may change after this review.

## 2. Frontend — verified strengths

The repository describes and configures:

- Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4 and shadcn/ui.
- Feature-oriented modules with atomic shared UI layers.
- TanStack Query, Zustand, React Hook Form and Zod.
- ESLint flat config with Next Core Web Vitals and TypeScript presets.
- Prettier and Tailwind class sorting.
- Vitest, Husky, lint-staged and Commitlint.
- Import-boundary restrictions in `eslint.config.mjs`.
- `npm run check` covering format check, typecheck, lint and tests.
- `AGENTS.md` contains explicit form conventions and tells agents to read the installed Next.js documentation because Next 16 has breaking changes.

### Frontend items to validate or improve

1. **Version freshness must be proven from the lockfile and official release channels.** The manifest uses version ranges for Next, React, Tailwind, TypeScript, ESLint, Vitest, shadcn-related dependencies and other packages. Do not assume the manifest range equals the installed version.
2. **Review dependency compatibility as a set**, not package by package: Next + React + ESLint config, Tailwind v4 + PostCSS plugin + Prettier Tailwind plugin, TypeScript + ESLint TypeScript support, and shadcn-generated components + Radix/Base UI dependencies.
3. **Audit the full source for `any`, unsafe assertions, non-null assertions, ignored TypeScript errors, broad `unknown` casts, unvalidated API payloads, and duplicated types.** The public root config does not prove all code is safe.
4. **Review React Server Component boundaries.** Check accidental client-component expansion, server-only modules imported into client bundles, secret leakage, async server component patterns, caching/revalidation semantics, and use of Next 16 APIs.
5. **Review forms and mutation flows.** Existing `AGENTS.md` mandates `FormWrapper` and controlled components. Validate that this abstraction supports accessibility, server errors, async defaults, reset, field arrays, and correct RHF/Zod integration. Avoid applying it where a native semantic form is more appropriate unless the repository's rule intentionally requires it.
6. **Review query key factories, invalidation, cancellation, optimistic updates, retry policy, hydration, and server/client query-client isolation.**
7. **Review Zustand usage.** Keep server data in TanStack Query; use Zustand only for client UI/workflow state. Prevent cross-user state leakage during SSR.
8. **Review shadcn/ui components.** Treat copied component source as owned code: compare with current official shadcn guidance, preserve local customizations, improve semantics/accessibility, and do not overwrite custom components with CLI output.
9. **Review Tailwind v4 usage.** Confirm CSS-first configuration, current utility syntax, theme tokens, responsive variants, dark mode and class ordering. Do not mechanically rewrite valid classes.
10. **Review accessibility and performance:** keyboard operation, focus management, labels, error announcements, reduced motion, image sizing, route loading states, bundle size and unnecessary client JS.
11. **Review tests:** ensure meaningful component, hook, API-contract and route behavior tests exist; test user-visible behavior rather than implementation details.

## 3. Backend — verified strengths

The repository describes and configures:

- Node.js `>=24`, TypeScript ESM, Express, PostgreSQL and Drizzle ORM.
- Redis, BullMQ, Socket.IO, S3-compatible storage and SES/email integrations.
- Zod environment validation, Pino structured logging and rate limiting.
- Multi-tenancy, RBAC, audit logs, queues, health checks, OpenAPI, metrics and graceful shutdown.
- `AGENTS.md` specifies tenant DB routing, RLS, authentication/permission middleware, migrations and tests.
- Scripts exist for typecheck, build, unit/integration tests, lint, formatting and Drizzle operations.

### Backend items requiring attention

1. **High-priority lint gap:** `eslint.config.js` explicitly sets `@typescript-eslint/no-explicit-any` to `off`. This conflicts with the desired strict type-safety standard. Turn it on after inventorying existing violations and migrate incrementally; do not hide the backlog with blanket disables.
2. **Potential Express type-version mismatch:** the public backend manifest declares `express` `^4.21.2` while `@types/express` is `^5.0.6`. Confirm the resolved lockfile versions and compatibility. Align Express runtime and type definitions deliberately; do not assume Express 5 type definitions are safe for Express 4.
3. **Mixed JWT libraries:** both `jose` and `jsonwebtoken` are dependencies. Inspect actual imports and token formats. Standardize on one library where feasible, based on current security requirements and interoperability; document any justified exception.
4. **Legacy/older dependency ranges need a full audit:** examples include AWS SDK packages declared from `^3.700.0`, Bull Board `^5.23.0`, Sentry Node `^8.55.2`, and other packages. These are review candidates, not automatic upgrade instructions. Compare lockfile-resolved versions to latest compatible stable releases and official migration notes.
5. **Drizzle API and migration safety:** inspect actual schema definitions, query APIs, transaction boundaries, prepared statements, tenant database selection, migration journal, RLS policies and generated SQL against the installed Drizzle version. Never run `drizzle-kit push` against production as a routine deployment strategy.
6. **Tenant isolation:** verify that every tenant-owned repository query uses the approved tenant DB abstraction and that RLS context is set/reset safely per pooled connection/transaction. Test missing, invalid, stale and cross-tenant context.
7. **Request validation:** every external input (path, query, body, headers, webhook) must be parsed and validated at the boundary. Do not trust TypeScript types for runtime input.
8. **Error handling:** verify a single typed error model, centralized Express error middleware, async handler behavior, safe client messages, correct status codes and no leaked stack/SQL/provider details.
9. **Queue safety:** validate idempotency, retry classification, backoff, dead-letter/failed-job operations, concurrency, graceful shutdown, tenant context propagation and duplicate job handling.
10. **Redis correctness:** define TTLs, invalidation, key namespacing, tenant/user scoping, stampede control and behavior during Redis outages. Avoid treating cache as the source of truth.
11. **Security review:** authorization at service/route boundaries, webhook signature verification on raw bytes, upload MIME/content validation, SSRF protections, CORS, rate limits, secret redaction, audit completeness and secure cookie/token lifecycle.
12. **Observability:** verify request/correlation IDs, structured logs, metrics cardinality, tracing, Sentry scrubbing, readiness/liveness and alertable failure signals.
13. **Tests:** add integration tests for tenant isolation, RLS, authorization, transactions, webhooks, queue retries, Socket.IO room authorization and graceful shutdown.

## 4. Cross-repository findings

- Both repositories already contain agent instruction files. Antigravity must read `AGENTS.md`, `.agents/` rules and `GEMINI.md` before changing code. Reconcile contradictory instructions instead of adding a second conflicting rule system.
- Both use ESLint and Prettier; lint quality depends on rule configuration and enforcement, not merely having those tools installed.
- Use lockfiles as the source of truth for installed versions.
- Add a CI quality gate that runs formatting, lint, typecheck, unit tests, integration tests where applicable, build, dependency/security checks and migration checks.
- Avoid one giant formatting/refactor commit mixed with behavior changes.

## 5. Priority classification

### P0 — correctness/security

- Backend `no-explicit-any` disabled.
- Confirm Express runtime/type compatibility.
- Audit tenant isolation, RLS, auth and permission enforcement.
- Audit secret handling, raw webhook verification, input validation and unsafe casts.

### P1 — engineering consistency

- Establish common TypeScript rules and typed error/result conventions.
- Audit dependency graph and remove duplicate/unused packages.
- Improve test coverage around critical flows.
- Enforce architecture boundaries and CI gates.

### P2 — maintainability/performance

- Simplify complex branching and duplicated logic.
- Improve React rendering/data fetching patterns.
- Improve query performance, logging/metrics and bundle performance.
- Document approved patterns and examples.

## 6. Required output from Antigravity

For each repository, produce:

1. Exact commit SHA and Node/package-manager versions.
2. Installed dependency inventory from lockfile.
3. `npm outdated`/equivalent report and security audit results.
4. TypeScript/ESLint/Prettier baseline.
5. Counts and file locations for `any`, `@ts-ignore`, `@ts-nocheck`, unsafe assertions, non-null assertions, TODOs and disabled lint rules.
6. Top 30 high-risk code findings with file/line, impact, evidence and proposed fix.
7. Architecture-boundary violations.
8. Test coverage gaps and baseline test/build results.
9. A prioritized, incremental remediation plan.
10. A list of changes made and exact verification output.

Do not claim a finding exists in source until it has been located and reproduced.
