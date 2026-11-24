# Multi-Tenant Backend Foundation Plan

This repository provides a reusable Node.js and Express API for multi-tenant SaaS products. The foundation owns identity, tenant isolation, access control, and shared services. Each business module owns its records, workflows, and policies.

The companion frontend plan is `docs/plans/multi-tenant-frontend-foundation.md` in `nextjs-frontend`.

## Phase status

| Phase                | Status                    | Remaining work                                                                                                                                                                                       |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 · Baseline         | Complete locally          | Run the paired GitHub Actions workflow on the published changes.                                                                                                                                     |
| 1 · Shared contracts | Complete locally          | Verify custom-domain DNS and TLS, legacy object migration, deployed bucket policies, and signed access in staging.                                                                                   |
| 2 · Optional modules | Complete for Leads        | Repeat capability, migration, and isolation checks when a second business module is added.                                                                                                           |
| 3 · Release          | Staging verification open | Verify sandbox SSO, SCIM, email, and payment reconciliation. Rehearse production-like upgrades and rollback. Extend import adapters and operational scopes when a second module defines their rules. |

### Completed by phase

- **Phase 0.** Isolated PostgreSQL and Redis fixtures, guarded migration and seeding, readiness checks, and a paired browser workflow.
- **Phase 1.** Tenant row-level security (RLS), shared and dedicated database routing, one-time handoff with active membership checks, scoped and expiring support sessions, realtime revocation, and private file scanning and retry.
- **Phase 2.** Leads registration, entitlements, and rollout checks. Local verification covers enabled, tenant-disabled, and deployment-omitted states and confirms that toggling access preserves data.
- **Phase 3.** Persisted SSO connection checks, scoped member import with progress and deduplication, and local PostgreSQL upgrade and restore rehearsals.

### Local verification

| Check                   | Result                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Backend test suite      | 542 passed                                                                                                                                |
| Targeted release checks | 89 passed across domain behavior, support expiry, SSO and SCIM contracts, email templates, billing, and file scanning                     |
| Paired Playwright       | 10 flows passed with Leads enabled and 10 with Leads omitted                                                                              |
| PostgreSQL              | Shared and dedicated databases upgraded from the previous schema. Restores preserved representative records and migration-journal counts. |
| MinIO and ClamAV        | A synthetic pending legacy file was scanned into private verified storage. Signed downloads and share redemption succeeded.               |

## Architecture and shared contracts

- **Module boundaries.** Compose routers in `src/routes.ts`. Each module owns its Zod DTOs, controller, service, repository, permissions, database schema, and tests. Use published contracts or domain events for cross-module interaction.
- **Identity and access control.** Authenticate the principal, resolve the tenant, and enforce membership, scope, permission, and resource ownership. Accept forwarded tenant context only from the authenticated BFF. Use the staff authorization path for control-plane operations and audit delegated support separately.
- **Persistence and isolation.** Use `withTenantTransaction` and the tenant database helpers for tenant-owned operations. Register tenant tables for RLS and verify policies, grants, and connection reuse in both database layouts. Use explicit primary database access for control-plane records.
- **Shared services.** Scope cache keys, jobs, outbox events, socket rooms, search, notifications, and object access by tenant. Make retries idempotent. Check ownership and scan state before issuing short-lived file links. Keep private objects outside public asset policies and redact sensitive values in logs.
- **API contract.** Coordinate versioned OpenAPI schemas, pagination, errors, correlation IDs, effective permissions, and capabilities with the frontend. Keep plan entitlements, rollout flags, and actor permissions independent.

## Module acceptance criteria

1. **Platform staff and tenant operations.** Keep staff authentication, recovery, session expiry, and logout separate from customer sessions. Provisioning tracks progress, failure and retry, owner invitations, and activation. Retries preserve one workspace. Suspension and reactivation apply to API and background work. Delegated support records grant, use, and termination, and access stops within the documented invalidation window.
2. **Customer identity and tenant context.** Verify invitation expiry, resend, acceptance, seat accounting, password recovery, MFA, refresh, and logout. Bind one-time handoffs to an authorized tenant and destination. Recheck active membership on redemption. Return canonical tenant identity and effective permissions, and invalidate access on revocation.
3. **Authorization and isolation.** Verify list, detail, and mutation policy decisions. Bind database transactions to tenant context and retain ownership predicates. Cover shared and dedicated layouts, worker and search context, and connection reuse. Confirm that a pooled connection carries no context from the previous request.
4. **Files and realtime.** Persist the scan verdict before exposing a file. Enforce scan and ownership requirements for preview, download, share creation, and share redemption. Use tenant-bound, idempotent jobs and bounded retries. Close workspace sockets and file streams after membership revocation. Periodic access checks close remaining connections within 30 seconds under normal database availability.
5. **Enterprise setup and lifecycle.** Verify delayed and duplicate billing events, payment reconciliation, effective plan dates, and seat limits. Track export and closure progress with permission, retention, retry, and audit rules. Publish SSO test outcomes, directory sync status, and scoped audit export with provider secrets redacted.
6. **Optional feature composition.** Register module keys, routes, permissions, migrations, RLS tables, and any worker, event, or search contributions. Apply deployment configuration and tenant capabilities before protected operations. Check enable, disable, and re-enable transitions with existing records.
7. **Reusable workflow extensions.** Use the existing member import as the baseline for a second module. Keep columns, uniqueness rules, relationships, and ownership checks in module adapters. Verify that preview makes no writes and retries preserve data. Apply tenant and operational-unit authorization to validation, execution, and results.
8. **Paired release verification.** Use isolated PostgreSQL, Redis, and object-storage fixtures. Check two-tenant requests and worker execution, then verify upgrade and restore for both database layouts. Publish request IDs and browser traces for failures.

## Release checklist

1. Run the checks below against isolated fixtures and verify fresh and upgrade migrations.
2. Publish the paired changes and record the hosted CI result for both configurations.
3. Validate real staging DNS and TLS, legacy object migration, bucket policies, and provider workflows for SSO, SCIM, email, and payments.
4. Rehearse production-like backup restore and deployment rollback for shared and dedicated databases.
5. Deploy compatible migrations and backend contracts before enabling dependent frontend features.

```sh
npm run typecheck
npm run lint
npm run db:check
npm test
npm run build
```

Use `npm run db:migrate:all` against isolated fresh and upgrade databases during the migration rehearsal.
