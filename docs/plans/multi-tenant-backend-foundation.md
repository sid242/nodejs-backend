# Multi-Tenant Backend Foundation Plan

**Goal** · Provide reusable tenant services and a stable API for independently owned business modules. Start with the existing modular Express application and keep deployment, data access, and operational conventions consistent across projects.

**Baseline** · Node.js and TypeScript, Express, PostgreSQL/Drizzle, Redis, BullMQ, Socket.IO, and S3-compatible storage. This PR improves authentication validation, tenant subscription usage, SCIM behavior, and test bootstrap. The companion frontend plan is `nextjs-frontend/docs/plans/multi-tenant-frontend-foundation.md`. [Backend PR #1](https://github.com/sid242/nodejs-backend/pull/1) · [Frontend PR #1](https://github.com/sid242/nextjs-frontend/pull/1)

## Implementation status

| Phase                | Implemented in this checkpoint                                                                                                                                                                                                                                        | Remaining verification or work                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 · Baseline         | Ran the API and worker against isolated PostgreSQL, Redis and MinIO fixtures. Verified readiness and migrations for the shared database and two dedicated fixtures.                                                                                                   | Automate paired fixture setup for CI.                                                                                                                                        |
| 1 · Shared contracts | Added workspace file permissions, private staging, ClamAV scanning, quarantine, and retry. File and notification events use workspace-bound sockets. Tenant context publishes possible Leads actions for UI gating while API requests still evaluate record policies. | Rehearse legacy file handling and bucket policy changes in staging. Verify revocation and delegated support across every channel.                                            |
| 2 · Optional modules | Registered Leads as the example module. Verified API and search in enabled, workspace-disabled and deployment-omitted configurations, and confirmed that toggling deployment access preserves records.                                                                | Repeat capability, migration and data checks as modules are added.                                                                                                           |
| 3 · Release          | Added persisted SSO configuration check results, scoped member import jobs with progress and duplicate submission handling, and local setup instructions. Verified import worker completion and a local backup restore.                                               | Verify production-like rollback and live sandbox SSO, SCIM, email, and payment setup. Extend imports and operational scope when a second business module has concrete rules. |

During implementation, the local backend suite passed 541 tests. A real ClamAV and MinIO smoke test passed upload, private staging, scan, and download. Dedicated database upgrades and a restore into a separate local database also passed.

## Architecture and ownership

| Area                       | Foundation responsibility                                                                                                                                    | Extension boundary                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                   | Platform staff authentication, tenant user authentication, sessions, MFA, token revocation and identity-provider integration                                 | Reuse the authenticated principal and membership lifecycle in feature modules                                                                                                          |
| Tenant and user management | Provision and resolve workspaces, invitations, membership, role assignments, settings and branding                                                           | Use stable tenant and user identifiers. Optional organizational hierarchies and product profiles belong with the modules that own those records                                        |
| Access control             | Tenant membership, namespaced RBAC permissions, resource policy evaluation and separately audited staff support                                              | Each module defines its actions and resource scoping. Services and repositories retain tenant filters. Feature flags and plan entitlements gate availability independently from access |
| Persistence                | PostgreSQL and Drizzle, transaction-local tenant context, RLS registration, explicit primary/control-plane tables, and shared and dedicated database routing | Each module owns its schema and migrations. Tenant-scoped tables must be registered and verified for the selected database mode                                                        |
| Common services            | Logging and traces, audit, outbox, cache, queues, storage, notifications, search and realtime delivery                                                       | Modules use shared interfaces and own event payloads, audiences, retention settings and retry behavior                                                                                 |

## API and tenancy contract

- Use `src/routes.ts` as the application composition entry. Each bounded module owns its router, Zod DTOs, controller, service, repository, permission definitions, schema and tests. Mount the router through explicit application configuration. Keep shared services free of imports from product modules. Use a module's public contract or domain event for cross-module interaction.
- Authenticate the principal, establish tenant context, verify required scope and permissions, parse inputs, and call the service. Recheck resource ownership where the operation depends on entity attributes. Accept forwarded tenant context only from the authenticated BFF channel and verify it against the request principal and resource. Route platform-scoped requests through the staff authorization path.
- Use the existing `withTenantTransaction` and tenant database helpers for tenant-scoped persistence operations. Bind context to the transaction and include tenant predicates or ownership checks for defense in depth. Use explicit primary database access for control-plane records. Verify RLS policies and roles for new tenant tables rather than assuming registration alone is sufficient.
- Scope cache keys, queues, events, socket rooms, search results and object access by tenant wherever they carry tenant data. Use idempotency for retried writes and jobs. Gate private files by ownership and permission before issuing a short-lived link. Keep private objects outside public asset policies. Redact secrets and sensitive payloads in structured logs.
- Publish OpenAPI contracts, shared error envelopes, correlation IDs, and pagination rules. Coordinate stable capability keys, effective permissions, `401`, `403` and `404` semantics with the frontend. Expose effective module availability through tenant context or the existing capability endpoints so the UI can use the same decision inputs.
- Keep SaaS subscriptions and metering in the platform boundary. Business transactions belong in their own modules. The existing Leads slice is a candidate for optional composition, with its current route, permissions and persisted records preserved for existing deployments during extraction.

## Phased implementation

| Phase                          | Work                                                                                                                                                                                                                                                                                                                  | Acceptance gate                                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 · Establish the baseline     | Map platform, tenant, and extension ownership. Inventory routers, permission catalog, tenant-table registry, search contributors and global seeds. Record which capabilities are currently coupled to common modules.                                                                                                 | Both repos use the same vocabulary and identify the same access and configuration boundaries. Existing CI and fixtures provide a reproducible baseline.                                                                                        |
| 1 · Harden shared contracts    | Verify tenant isolation for reads, writes, background jobs, realtime and files. Document platform support boundaries, membership changes, denial codes, traceability and compatible migrations.                                                                                                                       | Two tenants with distinct roles cannot see or change each other's records. Pooled transactions reset tenant context. Revoked access fails on the next authorized request or within the documented invalidation boundary.                       |
| 2 · Compose optional modules   | Define an explicit, typed registration contract for routes, permissions, schemas/migrations, optional workers, and search contributions. Resolve module availability from deployment configuration, tenant capabilities and rollout flags. Keep deployment-level module omission distinct from per-tenant enablement. | The foundation boots with and without a sample module. A disabled tenant cannot call its API or search its data. Existing enabled routes and records remain compatible. Each active tenant-scoped schema passes registry and isolation checks. |
| 3 · Validate reuse and release | Document how to add a module, use provider adapters, migrate shared/dedicated environments, operate background work and roll back a rollout. Exercise two synthetic application configurations without changing common core modules.                                                                                  | Fresh and upgrade migrations pass in isolated fixtures, worker retries preserve consistency, and both configurations meet the same integration, authorization, and contract checks.                                                            |

## Remaining implementation by module

The items below are implementation work. The current PR establishes the baseline and does not mark these items complete. Findings marked **Code finding** were observed in source. Items marked **Flow verification** need an integration or staging test. The numbered modules correspond to the companion frontend plan.

### 1. Platform staff identity and tenant operations

**Phase 1 · Flow verification.** Verify separate staff authentication, recovery, session expiry, and logout. Trace tenant provisioning through creation, data setup, owner invitation and activation. Keep control-plane writes separate from tenant data access.

- Reuse platform middleware and explicit permissions for lifecycle actions. Make provisioning steps retryable and idempotent. Persist a reason and operation status for failures. Check state transitions and concurrent retries before changing availability.
- Verify suspension and reactivation across tenant requests and background work. For support, scope delegated sessions to tenant, actor, purpose and expiry. Record grant, use, and termination. Recheck scope on each protected action.
- **Accept when** duplicate requests or failed steps never provision a second workspace, forbidden staff cannot mutate lifecycle state, and revoked or expired support access stops within the documented invalidation boundary.

### 2. Customer identity, invitations and tenant context

**Phase 1 · Flow verification.** Verify invitation expiry, resend, acceptance and seat accounting, password and MFA flows, handoff consumption, refresh and logout. Cover removed and suspended members and stale session state.

- Resolve workspace context from the verified request principal and workspace routing context. Validate active membership and tenant status for the chosen workspace. Keep platform and customer claims separate. Bind handoff to the authorized tenant and destination and preserve existing replay protections.
- Return canonical tenant identity and effective permissions in the context response. Coordinate membership and permission cache invalidation with the frontend. Document the order and observable outcomes of context, session, and permission changes.
- **Accept when** tests with two tenants confirm failed or stale transitions preserve isolation, concurrent invitations respect seat limits, and a user loses access on removal according to the documented session policy.

### 3. Authorization, policies and tenant isolation

**Phase 1 · Flow verification.** Reuse the current RBAC, policy and RLS layers. Inventory which operations require permission checks, row-level decisions, or explicit privileged access.

- Verify list, detail and mutation policy parity using Leads as the first module. Check mutation target membership and ownership against authoritative records. Define denial semantics and expose a stable effective-permissions contract for UI gating.
- Use tenant-bound transactions, explicit ownership predicates, and tenant-consistent relationships. Reuse the RLS inventory for tenant tables and check grants and role assumptions in runtime environments. Cover shared and dedicated database modes, connection reuse, and context in jobs and search.
- **Accept when** fixtures in two tenants preserve isolation for reads and writes, denied lists and direct resources behave consistently, permission changes invalidate effective access, and pooled connections do not retain tenant context.

### 4. Files, notifications and realtime

**Phase 1 · Code finding and flow verification.** The file worker currently reports processing complete without a scan. Download and share creation check for known infected files but also accept uploaded files pending a scan.

- Add a scanner adapter to the existing file worker and persist a terminal scan outcome before emitting readiness. Model pending, clean, quarantine and processing failure, including bounded retries and recovery. Enforce storage authorization and required scan policy consistently for previews, downloads, share creation and existing share redemption. Restrict exemptions to explicitly approved file types or sources.
- Bind jobs to the owning tenant and verified file record. Make completion idempotent and avoid treating progress as availability. Review queue and socket tenant scope, membership changes, outbox retries, and reconnect behavior. Publish delivery status for supported channels.
- **Accept when** isolation and integration tests cover clean, quarantined, pending and retry scenarios, signed access respects file state and ownership, and old membership cannot receive new workspace events.

### 5. Commercial, workspace lifecycle and enterprise setup

**Phase 1 verification, Phase 3 admin experience.** Use existing billing, privacy, audit, SSO and SCIM modules as the baseline.

- Verify billing webhook retries and event ordering, reconciliation, plan effective dates, and seat limits. Persist effective entitlements and expose them separately from rollout flags and user authorization. Keep provisioning and revocation idempotent.
- Exercise tenant export and closure across queues, DB and object storage. Define status, permission, retention, audit and retry expectations for each operation.
- Provide stable read models for enterprise setup, including SSO connection test and last outcome, Directory Sync provisioning health, and scoped audit export. Extend existing endpoints before creating parallel ones. Redact secrets and sensitive provider details.
- **Accept when** delayed or repeated billing events converge to the expected subscription state and setup and lifecycle failures are recoverable through authorized actions and auditable status.

### 6. Optional feature composition

**Phase 2 · Implementation gap.** Leads is mounted by the common router. Use it to prove optional registration without breaking current deployments.

- Define an explicit module registration contract for a stable module key, routes, permissions, migrations and RLS registration, and optional workers, search and event contributions. Keep the application composition root responsible for wiring. Publish compatible capability and error schemas for the frontend.
- Separate deployment-level registration from per-tenant availability. Resolve entitlements, rollout flags, and actor permissions using server-verified context. Apply capability checks consistently to API calls, search and event or job dispatch where applicable. Keep public flag evaluation independent of protected access decisions.
- **Accept when** the backend boots with or without Leads, disabling it per tenant blocks routes and dependent access, and existing enabled deployments retain their routes and stored records. Test enable, disable and re-enable transitions.

### 7. Reusable workflow extensions

**Phase 3 · Add when a second application validates the contract.** Define reusable import validation, preview, execution and result reporting using existing storage and queue services. Keep module-owned columns, uniqueness rules, record relationships and writes behind an adapter. Support permission scope inputs for operational units through explicit module-supplied ownership checks.

- Use tenant-authorized upload and export paths, idempotent execution with bounded chunks and a stable result identifier. Publish row-level errors without leaking unrelated records. Keep unit membership and hierarchy in the owning module.
- **Accept when** preview makes no writes, retries preserve data integrity, and fixtures prove that tenant and unit scope apply to validation, lookup, writes and reporting.

### 8. Paired integration and release verification

**Phase 0 baseline, Phase 3 release gate.** Use isolated PostgreSQL, Redis and object-storage fixtures. Run two-tenant request and worker tests, exercise shared and dedicated upgrades, and rehearse backup restore and deployment rollback in staging. Align CI with the paired browser job and publish request or correlation IDs for failures. Use sandbox providers to exercise SSO, email and payment workflows.

**Delivery order.** Establish fixtures and verify the baseline. Land additive tenant context, authorization and file-state contracts before dependent UI. Verify them alongside the frontend, then prove optional registration. Expand enterprise or workflow interfaces after the contracts are stable.

## Verification and release order

1. Agree on module keys, permission names and DTO examples before connecting the frontend. Land additive schema and API changes before dependent UI. Enable new capabilities after schema and compatibility checks, with a flag-off path that preserves existing records.
2. Run `npm run typecheck`, `npm run lint`, `npm run db:check`, `npm test` and `npm run build`. Use isolated PostgreSQL and Redis for integration tests, and rehearse migration changes against fresh and existing databases with `npm run db:migrate:all`.
3. Verify cross-tenant reads and writes, authorization after role changes, public versus private file handling, duplicate event processing, and old and new consumers. Keep product-specific entities, terminology, and compliance policies in their owning application modules.
