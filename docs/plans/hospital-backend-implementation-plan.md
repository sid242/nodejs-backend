# Hospital backend implementation plan

**Goal** · Deliver a branch-aware API for the outpatient workflow and preserve tenant isolation, clinical history and financial integrity as the dental and eye modules expand.

**Source and baseline** · `Plan_doc_hospital.md`, 12 October 2026, sections 2, 5–16. Use the shared roadmap in `nextjs-frontend/docs/plans/hospital-platform-implementation-plan.md` for product sequencing. This plan starts from backend `da3a581` and frontend `dccaac2`. [Backend PR #1](https://github.com/sid242/nodejs-backend/pull/1) · [Frontend PR #1](https://github.com/sid242/nextjs-frontend/pull/1)

## Architecture and existing entry points

Keep the modular Express API, PostgreSQL/Drizzle, Redis, BullMQ, Socket.IO and S3. Implement each new domain in a bounded module with parsed DTOs, a service that owns state changes, and a repository that queries within the authorized tenant scope. Keep SaaS subscription billing in its current module. Build patient billing as a separate ledger and permission surface.

| Existing entry point                                                                                                | Planned use                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes.ts`, `src/middleware/tenant.ts`, `src/modules/rbac` and `src/modules/policies`                          | Reuse verified tenant identity and access decisions. Add an explicit branch authorization step after tenant resolution                                                                                                                    |
| `src/db/tenancy/context.ts`, `src/db/tenancy/rls.ts`, `src/db/tenancy/tenant-tables.ts` and `src/db/migrate-all.ts` | Bind queries to the tenant transaction, register hospital tables for RLS and verify shared and dedicated database migrations                                                                                                              |
| `src/modules/audit`, `src/modules/privacy` and `src/queues/workers/outbox.worker.ts`                                | Reuse generic mechanisms for immutable events and reliable delivery. Extend for patient record reads, sharing, consent, exports and retention                                                                                             |
| `src/lib/s3.ts` and `src/modules/files`                                                                             | Reuse signing and file processing interfaces through a private clinical storage policy. Current bucket policy permits public reads for `tenants/*`, `avatars/*` and `branding/*`, and the generic file router supports public share links |
| `src/sockets`, `src/modules/notifications`, `src/modules/search` and `src/docs/openapi.ts`                          | Reuse scoped events, search, notifications and contract documentation. Add hospital payloads only after audience and permission rules are established                                                                                     |

## Phase 0 · Baseline and release safeguards

- [ ] **Access model.** Define tenant-wide, branch-bound, assigned-patient and consent-gated decisions. Record the patient master as tenant-scoped and require a branch on operational records. Confirm the PRD proposal for cross-branch chart access by treating clinicians, with read audit and a branch-only configuration. Model branch roles separately from legacy tenant memberships so upgrading an existing workspace preserves its normal SaaS behavior.
- [ ] **Clinical files.** Use a dedicated private bucket or a separately enforced private storage boundary that excludes all public prefixes and generic public shares. Validate effective bucket policy, KMS key policy, tenant/object binding and scan status. Record access before issuing short-lived links and keep object identifiers out of public queues or notifications. Include existing public branding/avatar access in regressions.
- [ ] **Isolation and operations.** Prove `withTenantTransaction` and the production-equivalent database role on two tenants using pooled requests. Add coverage for background jobs, search, audit exports, sockets and signed media. Document retention, recovery objectives and clinic escalation contacts before enabling real patient data.
- [ ] **Compliance decisions.** Have the appropriate owners confirm notice and guardian evidence, permitted cross-branch sharing, financial classifications, retention and erasure exceptions, incidents, hosting and ABDM launch obligations. Keep the attachment's regulatory dates as discussion inputs and confirm the current official version before production. [DPDP Rules](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa) · [ABDM integration guidance](https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf)

## Phase 1A · Branch scope and patient registration

### Backend PR A · Branch foundation

1. [ ] Use `src/db/schema/tenancy` or an adjacent organization schema group for Branch, Department, Room/Chair and branch role assignments. Register tenant tables in the tenancy registry and add additive Drizzle migrations. Use tenant-aware foreign keys to keep a department or room within its parent branch. Scope branch assignment to tenant membership. Backfill only explicitly opted-in hospital workspaces with agreed branch mappings.
2. [ ] Add organization routes, candidate namespace `/api/v1/tenants/:tenantId/branches`, and a branch context DTO containing branch ID, display name and effective allowed actions. Require branch identifiers on branch-bound writes and validate access from authenticated membership and a tenant-owned branch record. Consolidate exact routes and errors in OpenAPI before frontend integration.
3. [ ] Add role fixtures for branch manager, reception, clinical and cashier and tests for two tenants, multiple branches, stale assignments and shared versus dedicated databases. Verify that a tenant-wide administrator sees only the authorized tenant and that a customer-supplied branch selector grants no permission by itself.

**Acceptance** · A branch manager can create or list authorized resources. A member without assignment receives the agreed access error on direct reads and writes. Fresh and existing schemas migrate successfully with no out-of-tenant data.

### Backend PR B · Patient index, consent and patient read audit

1. [ ] Add a patient module and schema for the tenant patient master, identifiers, guardian/dependent links, scoped indexes, normalized contact fields and duplicate candidates. Keep merge lineage and retain source identifiers. Require review when identity matches are ambiguous.
2. [ ] Add purpose-specific consent versions, evidence, withdrawal and guardian verification flows. Separate an internal clinic patient record from the future portal login. Keep patient details and identifiers out of request logs. Implement role-specific DTO projections and append read, export, merge and consent events under the appropriate tenant and branch context.
3. [ ] Add dry-run and apply jobs for patient import with stable row identities and row-level error handling. Move clinical attachments through the approved storage policy. Publish safe query keys, contract examples, denied-response expectations and audit acceptance tests for frontend integration.

**Acceptance** · Registration and lookup work across permitted branches without duplicate patient IDs. A verified guardian links to the intended dependent only. A rejected cross-tenant read returns no record fields. Authorized cross-branch chart reads are attributable in the audit trail. Replaying an import does not create duplicate rows.

## Phase 1B · Appointments, visit transitions and tokens

- [ ] Add doctor profiles and branch schedules, resource/holiday calendars, booking, cancellation, no-show and check-in. Store time consistently and resolve clinic-local time at the boundary. Use database-backed concurrency constraints or transaction locking for overlapping doctor, chair and equipment bookings, and preserve reschedule history.
- [ ] Add a branch-scoped visit transition model and a queue with stable token issuance. Publish committed state changes through the existing outbox. Authorize Socket.IO room membership by tenant and branch and send minimal display events. Use snapshots after reconnect and idempotency keys for retried actions. If reception offline is included, reconcile provisional tokens and duplicate candidates server-side.
- [ ] Add approved appointment notifications, delivery events and opt-out policies. Keep patient identifiers, diagnostic detail and treatment notes out of channel payloads. Make waitlist automation, recurring booking and offline behavior individually testable where included in MVP.

**Acceptance** · Parallel booking requests cannot double-book any required resource. Retrying check-in issues one final token. A socket for a different tenant or unauthorized branch receives no events. The public display shows only the agreed token/status payload.

## Phase 1C · Encounter core and dental/eye packs

- [ ] Add a shared encounter aggregate with visit link, observations, allergies, diagnosis, prescriptions, orders, consent references and private attachments. Store versioned clinical forms and signed note snapshots. Use a state transition for signing and represent amendments as attributable addenda. Define delegation and emergency access with the clinical owner under existing audit workflows.
- [ ] Add shared care plans, planned visit sequence, items, charges and status history. Design the package balance ledger in this slice and deliver prepaid purchase, attendance consumption, expiry, pause and reversal with Phase 1D. Link each ledger entry to its visit or financial event so the same event cannot consume a package twice (FR-CPC-01–04).
- [ ] Implement dental tooth/surface and periodontal charts, planned and completed procedures, and eye OD/OS records for pre-tests, examination and refraction. Validate required tooth or laterality and lock them with the signed version. Publish versioned prescription and print-data DTOs with a clinic-approved terminology mapping.

**Acceptance** · Signed records persist through a newer template version. Unauthorized staff see operational status or authorized projections only. The test fixture can record dental and eye visits and produce a signed prescription with the correct chart context.

## Phase 1D · Clinical billing and pilot rollout

- [ ] Implement branch price books, tax classification with effective dates, invoice numbering, receipts, ledger, advances, partial payments, credit notes, refunds, discount approval thresholds and cash closing. Snapshot price and tax metadata at issue time. Reuse gateway infrastructure with credentials and webhooks scoped to the patient commerce flow. Validate signatures and process each payment event once.
- [ ] Add scoped owner and branch reporting, patient access history, reviewer-attributed exports and data-rights workflows. Run the registration-to-reconciliation pilot with both specialty fixtures. Capture audit, recovery, latency and privacy evidence against the rollout gates.

**Acceptance** · Duplicate payment events do not double-post. A partial payment and refund reconcile to the ledger, cash close and reports. Later price or tax changes preserve issued invoice amounts. A cross-branch report requires explicit permission and totals match allowed branches.

## Phases 2 and 3 · Extensions

| Phase                  | Backend work                                                                                                                                                                                                                               | Release evidence                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 · Operations         | Claim/pre-authorization lifecycle and patient/insurer split, stock and purchase ledger, batches and expiry, transfers, prescription dispensing, optical work orders, dental lab, imaging and diagnostics, OT resources and surgery records | Claims, cash and stock reconcile. Restricted imaging links expire and remain private. Device integrations and surgery checklist contracts are approved for the pilot |
| 2 · Portal and packs   | Patient/guardian OTP, dependent grants, scheduling and documents, data requests, physiotherapy assessment and session notes, exercise programmes, package-backed appointments and equipment register                                       | A guardian can reach only authorized dependent records. Duplicate attendance events consume one session. Individual flags allow independent rollout                  |
| 2 · ABDM               | ABHA link and verification, facility/professional IDs, versioned FHIR export and consent artefacts for approved outbound sharing. Move required milestones earlier if the pilot contract requires certification                            | The selected sandbox milestones pass, and revocation/expiry prevent further release                                                                                  |
| 3 · Growth and quality | Recall rules, channel preferences, feedback, external teleconsultation integration, accreditation logs and inbound read-only ABDM exchange if approved                                                                                     | Opt-out and guardian rules suppress ineligible messages. External records retain provenance and are read-only. IVF stays in a separate discovery and PRD track       |

## Verification and deployment sequence

1. Run `npm run typecheck`, `npm run lint`, `npm run test:unit` and `npm run build` for each backend slice. Run focused regression tests for the touched workflow and `npm run test:integration` against isolated PostgreSQL and Redis fixtures. Extend the existing tenant-isolation, support-scope and audit-immutability integration tests where relevant.
2. For schema work, run `npm run db:check`, rehearse `npm run db:migrate:all` on fresh and previous-schema test databases, and verify RLS coverage and the production-equivalent role. Rehearse restore before the first real-data rollout. Backfill with audit counts and keep flags disabled until verification passes.
3. Publish Zod/OpenAPI contracts and example errors with each API change. Pair rollout with the linked frontend PR. Deploy compatible schema and API first, then enable the frontend flag in staging and one pilot workspace. Keep a flag-off rollback path and preserve signed and financial history if rollout is paused.

Planning structure adapted from [Superpowers Writing Plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md).
