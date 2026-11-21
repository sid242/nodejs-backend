# Quality Backlog & Remediation Plan — Backend Repository

**Repository:** `sid242/nodejs-backend` (`node-scalable-foundation`)  

---

## Prioritized Remediation Backlog

### P0 — Safety, Security & Lint Enforcement
- [x] **Empty Catch Block Remediation**: Resolved empty catch blocks in `scripts/start-all.mjs` to conform with `no-empty` ESLint rule.
- [ ] **Align Express Types**: Align `@types/express` (`^5.0.6`) with `express` (`^4.21.2`) or plan verified migration to Express 5.
- [ ] **Progressive `no-explicit-any` Migration**: Enable `@typescript-eslint/no-explicit-any: warn`, then incrementally eliminate the 182 occurrences across controllers, DTOs, and socket events until strict `error` can be enforced.
- [ ] **Dual JWT Consolidation**: Audit usage of `jsonwebtoken` vs `jose` and consolidate on `jose` for auth token verification and signing.

### P1 — Engineering Consistency & Strictness
- [ ] **TypeScript Compiler Hardening**: Evaluate incremental addition of `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` to `tsconfig.json`.
- [ ] **Unused Import Cleanup**: Clean up inventoried unused variables and imports across schema, seed, and repository modules.
- [ ] **ESLint Rule Expansion**: Enable `@typescript-eslint/no-floating-promises` and `@typescript-eslint/consistent-type-imports`.

### P2 — Maintainability & Performance
- [ ] **Control Flow Simplification**: Replace nested conditional branching in complex billing and membership workflows with guard clauses and exhaustive `switch` cases.
- [ ] **Prettier Bulk Alignment**: Execute isolated formatting pass across repository files.
