# Master Antigravity Prompt — Raise Both Repositories to Production-Grade Quality

You are working with two existing repositories:

- Frontend: `https://github.com/sid242/nextjs-frontend`
- Backend: `https://github.com/sid242/nodejs-backend`

Your task is to perform a deep engineering-quality audit and then incrementally improve the existing code. The goal is excellent code quality, modern supported APIs, maintainability, type safety, security, performance and production reliability.

Read every document in this package before making changes. Also read the current repository's `AGENTS.md`, `.agents/` rules, `GEMINI.md`, README, package manifests, lockfiles, CI workflows and relevant framework documentation installed in `node_modules`.

## Non-negotiable rules

1. **Audit before editing.** Record branch, commit SHA, Node version, package manager, lockfile, commands and baseline results.
2. Do not assume the public README is proof of implementation quality.
3. Do not rewrite architecture just because you prefer another pattern. Preserve valid existing design and document justified changes.
4. Do not upgrade all packages to `latest` blindly. Verify compatibility, Node engine constraints, peer dependencies, migration guides, changelogs and security advisories.
5. Do not use `any`. Use `unknown` at untrusted boundaries and narrow it. Avoid `as` casts unless a documented invariant justifies them.
6. Do not silence errors with `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `as any`, non-null assertions or empty catch blocks. Any exception must be narrow, explained and reviewed.
7. Do not replace every `if` with `switch`. Choose the construct that makes intent clearest. Use lookup objects for static mappings, `switch` for finite discriminated unions or distinct cases, and guard clauses for early exits.
8. Do not use optional chaining or `??` merely to make errors disappear. Preserve required-field validation and distinguish `null`, `undefined`, `false`, `0`, `''` and missing data.
9. No behavior-changing refactor without tests that prove the old and new behavior.
10. Never commit secrets, real `.env` files, production data or generated credentials.
11. Do not perform destructive database changes or production migrations without explicit approval and a reviewed rollback plan.
12. Keep frontend and backend contracts synchronized. Prefer generated or shared contract types only if the repository architecture supports a safe, versioned contract boundary.
13. Make small, reviewable changes. Separate formatting-only, dependency-only, behavior, schema and architecture changes.
14. Every new feature must include validation, authorization, error handling, tests, logging/observability where appropriate, and documentation.
15. Do not claim completion until verification commands have actually passed.

## Phase 0 — Establish baseline

For each repository:

- Confirm current commit SHA and working tree state.
- Read all agent instructions.
- Detect package manager from lockfiles; use the existing package manager.
- Record Node/npm/pnpm versions and package engine requirements.
- Install dependencies reproducibly from lockfile.
- Run existing format check, lint, typecheck, unit tests, integration tests, build and database checks where safe.
- Save command output and distinguish pre-existing failures from introduced failures.
- Inspect CI workflows and compare local checks with CI.

Do not edit source in this phase.

## Phase 1 — Full source audit

Search the entire tracked source, including tests, scripts and config, for:

- `any`, `as any`, unsafe type assertions, `!` non-null assertions.
- `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `@ts-expect-error`.
- `==`/`!=`, nested ternaries, deep conditional chains, duplicated switch/mapping logic.
- `||` used as fallback where `0`, `false` or empty string are valid values.
- unsafe optional chaining and unchecked array indexing.
- empty catch blocks, swallowed errors, unhandled promises and floating promises.
- `console.log`, secrets in logs, sensitive values in errors.
- `TODO`, `FIXME`, `HACK`, dead code, unused dependencies and exports.
- duplicated validation, duplicated API clients, duplicated business rules.
- direct DB calls bypassing repositories/tenant context.
- authorization checks performed only in the UI.
- missing request validation, rate limiting, idempotency and transaction boundaries.
- React effects used to derive state, unstable query keys, duplicated server state in Zustand.
- client components that can remain server components.
- inaccessible controls and missing loading/error/empty states.

For each finding include file, line, evidence, severity, recommended fix and regression test.

## Phase 2 — Standards and tooling

Implement standards from `shared/ENGINEERING_STANDARDS.md` and `shared/DEPENDENCY_AND_TOOLING_POLICY.md`.

- Strengthen TypeScript compiler options only after inventorying resulting errors.
- Enable strict ESLint rules in stages; never disable a rule globally to get a green build.
- Add architecture boundary checks where they are enforceable.
- Make `format:check`, lint, typecheck, tests and build part of required CI.
- Ensure CI uses lockfile-frozen installation.
- Add dependency/security scanning and scheduled dependency review.
- Configure pre-commit hooks as developer convenience, not as a substitute for CI.

## Phase 3 — Frontend remediation

Follow `frontend/FRONTEND_STANDARDS.md`.
Prioritize correctness and security, then architecture and readability, then performance and polish.

## Phase 4 — Backend remediation

Follow `backend/BACKEND_STANDARDS.md`.
Prioritize tenant isolation, authentication/authorization, input validation, data integrity and operational reliability before style refactors.

## Phase 5 — Dependency modernization

For every direct and important transitive dependency:

- Record installed version from lockfile.
- Record latest stable version compatible with supported Node/runtime/framework versions.
- Check peer dependencies and breaking changes.
- Read official migration notes.
- Identify deprecated APIs and replacements.
- Upgrade in small groups, run all relevant tests after each group.
- Do not use prerelease/canary/nightly unless explicitly justified.
- Do not force overrides to hide incompatibilities.
- Keep lockfile deterministic.

## Phase 6 — Refactor by bounded domain

Refactor one module or feature at a time:

1. Add/adjust tests.
2. Improve types and validation.
3. Simplify control flow.
4. Separate responsibilities.
5. Improve names and boundaries.
6. Run focused tests.
7. Run full checks.
8. Summarize diff and risks.

## Required deliverables

Create and maintain:

- `docs/engineering/BASELINE_AUDIT.md`
- `docs/engineering/DEPENDENCY_AUDIT.md`
- `docs/engineering/QUALITY_BACKLOG.md`
- `docs/engineering/ARCHITECTURE_DECISIONS.md`
- `docs/engineering/REFACTOR_LOG.md`

For every changed area include:

- What was wrong.
- Why the new implementation is better.
- Behavior preserved or intentionally changed.
- Tests added/updated.
- Commands run and actual results.
- Remaining risks and follow-up tasks.

## Completion criteria

A repository is not "production grade" merely because it compiles. Completion requires:

- No new lint/type errors.
- No unreviewed unsafe casts or ignored diagnostics.
- Critical paths covered by meaningful tests.
- Authorization and tenant isolation verified at backend boundaries.
- Dependency versions supported and lockfile reproducible.
- No known high/critical security issues left untriaged.
- Migrations are reviewed and safe.
- CI enforces the same checks as local development.
- Documentation accurately reflects the implementation.

Start by producing the audit report and prioritized backlog. Do not begin broad source changes until the audit findings are presented.
