# Code Quality Remediation Roadmap

Do not attempt a giant rewrite. Use these phases independently for frontend and backend.

## Phase A — Baseline and inventory

Deliver:

- Exact commit SHA.
- Lockfile and runtime versions.
- Current command results.
- Full source scan report.
- Dependency report.
- Architecture map.
- Top risk findings.

Exit criteria: findings are evidence-based and prioritized.

## Phase B — P0 safety and correctness

Backend:

- Tenant context and tenant DB routing.
- RLS and connection-pool context isolation.
- Authentication/session/token lifecycle.
- Authorization and platform-vs-tenant boundary.
- Runtime input validation.
- Express/type-definition compatibility.
- Raw webhook signature verification.
- Sensitive log redaction.

Frontend:

- Server/client boundary and secret exposure.
- Auth refresh behavior and redirect safety.
- Tenant/user query cache isolation.
- Form validation and mutation duplicate prevention.
- Permission-based UI remains presentation-only; backend is authoritative.

Exit criteria: critical integration tests prove deny paths and isolation.

## Phase C — Type safety

- Remove `any` and `as any`.
- Replace unsafe external types with `unknown` + runtime parsing.
- Remove unjustified non-null assertions and suppression comments.
- Improve discriminated unions and exhaustive switches.
- Introduce branded IDs selectively.
- Enable stricter compiler options incrementally.

Exit criteria: no new unsafe escapes; remaining exceptions have documented rationale and owner.

## Phase D — Code design and readability

- Replace deep nested conditionals with guard clauses where appropriate.
- Use `switch` for finite variants and exhaustive state machines.
- Use typed lookup objects for static mapping tables.
- Use `??` instead of `||` where false/zero/empty string are valid.
- Use optional chaining only for genuinely optional values.
- Split high-complexity functions and responsibilities.
- Remove duplication and dead code.
- Fix module boundaries and circular dependencies.

Exit criteria: behavior tests pass; no purely stylistic changes mixed with behavior changes.

## Phase E — Framework and dependency modernization

Frontend:

- Next 16 and React 19 API audit.
- Tailwind v4 and shadcn/ui compatibility.
- TanStack Query, RHF/Zod and testing stack compatibility.

Backend:

- Node 24+ API/runtime audit.
- Express and type package alignment.
- Drizzle API/migration audit.
- Redis/BullMQ/Socket.IO compatibility.
- AWS SDK, Pino, Sentry and auth library audit.

Exit criteria: all upgrades are supported, documented and verified.

## Phase F — Test and CI maturity

- Add unit tests for pure logic.
- Add integration tests for DB and Redis boundaries.
- Add browser tests for critical frontend flows.
- Add tenant isolation and authorization regression suites.
- Add migration checks.
- Make CI gates required on protected branches.

Exit criteria: CI reproducibly enforces required checks.

## Phase G — Performance and operations

Frontend:

- Reduce unnecessary client JS.
- Review bundle and route performance.
- Optimize data fetching and cache behavior.
- Improve accessibility and loading/error/empty UX.

Backend:

- Review query plans and indexes.
- Review DB pool budgets and timeouts.
- Review queue concurrency and retries.
- Review Redis memory/key cardinality.
- Review metrics cardinality, tracing and alerting.
- Verify graceful shutdown and readiness behavior.

Exit criteria: measurable baseline and improvement evidence.

## Change management rules

- One bounded feature/module per pull request.
- Separate dependency upgrades, formatting, behavior changes and migrations.
- Add tests before refactoring behavior.
- Do not mass-format the entire repository unless isolated in its own PR.
- Keep a `REFACTOR_LOG.md`.
- For every change, show diff summary, risks and actual command output.
