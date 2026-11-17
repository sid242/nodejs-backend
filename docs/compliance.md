# Audit Trail, Data Retention & Compliance Architecture

This document outlines the security, compliance, and tamper-evident guarantees of the audit logging infrastructure across customer workspaces and internal platform operations, satisfying SOC 2 Type II, ISO/IEC 27001, HIPAA, and DPDP Act requirements.

---

## 1. Scope & Recorded Security Events

Every sensitive state mutation, access change, authentication attempt, and delegation action produces an immutable audit record:

| Category | Typical Actions | Captured Metadata & Actors |
| :--- | :--- | :--- |
| **Authentication & SSO** | `AUTH.LOGIN`, `AUTH.LOGOUT`, `SSO.CONFIG_UPDATED`, `SSO.BREAK_GLASS_BYPASS`, `SCIM.USER_PROVISIONED`, `SCIM.USER_DEACTIVATED` | User ID, denormalized actor snapshot (`actorEmail`, `actorName`), IP address, user agent, requestId |
| **Role & Permission RBAC** | `ROLES.ASSIGNED`, `ROLES.REVOKED`, `ROLES.CREATED`, `TENANT.OWNERSHIP_TRANSFERRED` | Operator ID, target member ID, affected permission list, previous vs updated roles |
| **Workspace & Settings** | `TENANTS.UPDATE`, `BRANDING.UPDATE`, `DOMAINS.VERIFIED`, `AUDIT.POLICY_UPDATED` | Workspace slug, domain name, modified settings before/after |
| **Billing & Subscriptions** | `SUBSCRIPTION.CREATED`, `SUBSCRIPTION.CANCELLED`, `PLAN.CHANGED`, `INVOICE.PAID` | Plan tier, seat changes, stripe customer/subscription references |
| **Platform Delegation** | `SUPPORT.START`, `SUPPORT.MUTATION`, `IMPERSONATION.START`, `IMPERSONATION.END` | Staff member ID, target workspace, support session ID, approved scope (`READ_ONLY`, `ASSIST`, `FULL_ADMIN`) |
| **Database Operations** | `DB_OPS.SWITCHOVER`, `DB_OPS.ROLLBACK`, `DB_OPS.BACKUP_CREATED`, `DB_OPS.RESTORE` | Source host, target host, migration tag, duration, operator staff ID |

---

## 2. Cryptographic Tamper-Evidence & Hash Chaining

To guarantee non-repudiation and prevent undetected modification or deletion of historical records:

1. **Sequential Hash Chaining**:
   - Each audit record stores `prevHash` and `rowHash`.
   - The first row in a workspace chain links to `GENESIS_HASH` (`0000000000000000000000000000000000000000000000000000000000000000`).
   - Every subsequent record calculates:
     $$\text{rowHash} = \text{SHA-256}(\text{prevHash} \mathbin{\Vert} \text{tenantId} \mathbin{\Vert} \text{action} \mathbin{\Vert} \text{actorUserId} \mathbin{\Vert} \text{actorEmail} \mathbin{\Vert} \text{result} \mathbin{\Vert} \text{entityType} \mathbin{\Vert} \text{entityId} \mathbin{\Vert} \text{createdAt})$$
2. **Verification Endpoint & Nightly Job**:
   - Workspace administrators can verify integrity on-demand via `GET /api/v1/tenants/:tenantId/audit/verify`.
   - Platform staff can verify any workspace via `GET /api/v1/platform/audit-logs/verify/:tenantId`.
   - A nightly BullMQ worker (`verify-audit-chains`) verifies all active tenant chains and raises critical alerts if a broken link or altered row hash is detected.

---

## 3. Database-Level Immutability Protection

In addition to API application controls, PostgreSQL database triggers enforce immutability at the storage engine level:

1. **Strict No-Update Trigger (`trg_audit_log_no_update`)**:
   - `BEFORE UPDATE ON "AuditLog"` executes `prevent_audit_log_mutation()`.
   - Rejects all `UPDATE` queries with an uncatchable SQL exception, ensuring audit logs cannot be modified once written.
2. **Authorized Purge Guard (`trg_audit_log_purge_guard`)**:
   - `BEFORE DELETE ON "AuditLog"` executes `check_audit_log_purge_authorized()`.
   - Direct `DELETE` queries are rejected unless the session explicitly sets `SET LOCAL app.allow_audit_purge = 'true'`, which is only ever permitted inside authorized, S3-archived retention batch jobs.

---

## 4. Cold Storage Archival & Retention Purge

1. **Configurable Retention Policy**:
   - Default retention: 90 days.
   - Enforced minimum: 7 days.
   - Enterprise workspaces: up to 10 years (3,650 days).
2. **Export Before Deletion (`audit-archive`)**:
   - Before any expired records are purged, they are extracted in chronological batches.
   - Serialized into Newline-Delimited JSON (NDJSON) and compressed with `gzip`.
   - Uploaded to secure S3 cold storage:
     `s3://{BUCKET}/audit-archive/{tenantId}/{YYYY}/{MM}/audit-archive-{timestamp}.ndjson.gz`
   - SHA-256 integrity checksum and record count are attached as S3 object metadata.
3. **Batched Deletion**:
   - Once S3 cold storage upload is verified, expired records are deleted in batches of 5,000 without `RETURNING` to prevent memory spikes on large tables.
   - Every retention run is recorded in `AuditRetentionRun` (`rowsArchived`, `rowsPurged`, `archiveS3Key`, `archiveSha256`, `status`, `completedAt`).

---

## 5. Denormalized Actor Snapshots

To maintain attribution when user identities are deactivated or deleted:
- Every audit record captures frozen copies of `actorEmail` and `actorName`.
- If an account is deleted under "Right to be Forgotten" (GDPR / DPDP), the user's primary identity record is removed while the audit log retains the immutable historical attribution necessary for regulatory compliance.
