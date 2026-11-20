# Data Privacy Map & PII Inventory (GDPR / India DPDP)

This document provides a comprehensive inventory of all Personal Identifiable Information (PII) processed across the platform, classifications, lawful basis under **GDPR Article 6** and the **Digital Personal Data Protection Act (DPDP) 2023**, and technical retention rules.

---

## 1. PII Classification Taxonomy

| Class | Definition | Security Controls |
| :--- | :--- | :--- |
| **Direct Identifier** | Values directly identifying an individual (Name, Email, Phone, National ID) | Redacted in logs, TLS in transit, masked on UI |
| **Contact Data** | Physical addresses, billing coordinates, delivery details | Restricted RBAC, tenant isolated |
| **Security Credential** | Passwords, TOTP secrets, recovery codes, cryptographic tokens | One-way hashing (bcrypt), HKDF AES-256-GCM envelope encryption |
| **Pseudonymous / Telemetry** | IP addresses, User-Agents, geo coordinates, session identifiers | Truncated/hashed, bounded retention (30–365 days) |
| **Legal & Compliance** | Audit trail actor hashes, consent timestamps, legal holds, tombstones | Tamper-evident Merkle hash chain, WORM storage |

---

## 2. Table-by-Table Data Map

### 2.1 Identity & Users (`User`, `Session`, `UserLoginEvent`)

| Table | Column | PII Class | Lawful Basis | Retention | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `User` | `id` | Pseudonymous | Contract (Art 6(1)(b)) | Life of account + 90d | Primary UUID |
| `User` | `email` | Direct Identifier | Contract (Art 6(1)(b)) | Life of account | Replaced with `deleted+{id}@invalid` upon anonymization |
| `User` | `firstName`, `lastName` | Direct Identifier | Contract (Art 6(1)(b)) | Life of account | Nulled upon account deletion |
| `User` | `phoneNumber` | Contact Data | Consent / Security | Life of account | Nulled upon account deletion |
| `User` | `passwordHash` | Security Credential | Security (Art 6(1)(f)) | Life of account | bcrypt 12 rounds; nulled on deletion |
| `User` | `twoFactorSecret` | Security Credential | Security (Art 6(1)(f)) | Life of account | Encrypted AES-256-GCM; nulled on deletion |
| `User` | `twoFactorRecoveryCodes` | Security Credential | Security (Art 6(1)(f)) | Life of account | bcrypt hashed array |
| `Session` | `ipAddress`, `userAgent` | Pseudonymous | Security (Art 6(1)(f)) | 30 days | Purged on logout or session expiration |
| `UserLoginEvent` | `ipAddress`, `userAgent`, `city`, `country` | Pseudonymous | Security (Art 6(1)(f)) | 365 days | Purged by `retention-sweep` |

### 2.2 Organizations & Tenancy (`Tenant`, `TenantMember`, `TenantInvitation`)

| Table | Column | PII Class | Lawful Basis | Retention | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Tenant` | `name`, `slug` | Identifier | Contract (Art 6(1)(b)) | Life of tenant | Preserved in `TenantTombstone` for 90d post purge |
| `Tenant` | `legalName`, `billingEmail` | Contact Data | Legal obligation (Art 6(1)(c)) | 7 years (tax/invoicing) | Archived with billing records |
| `TenantMember` | `userId`, `tenantId`, `role` | Pseudonymous | Contract (Art 6(1)(b)) | Life of membership | Cascades or anonymizes on deletion |
| `TenantInvitation` | `email` | Contact Data | Legitimate interest | 7 days | Auto-expires or purged after usage |

### 2.3 Physical Addresses & Geolocation (`Address`)

| Table | Column | PII Class | Lawful Basis | Retention | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Address` | `recipientName`, `phone` | Direct Identifier | Contract (Art 6(1)(b)) | Life of profile / tenant | User or workspace owned |
| `Address` | `line1`, `line2`, `landmark` | Contact Data | Contract (Art 6(1)(b)) | Life of profile / tenant | Street addresses |
| `Address` | `postalCode`, `countryCode` | Contact Data | Contract (Art 6(1)(b)) | Life of profile / tenant | Used for billing and localized taxation |
| `Address` | `latitude`, `longitude` | Pseudonymous | Consent / Contract | Life of profile / tenant | Optional GPS pin coordinates |

### 2.4 Files & Documents (`File`, `FileVersion`)

| Table | Column | PII Class | Lawful Basis | Retention | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `File` | `filename`, `key` | Metadata | Contract (Art 6(1)(b)) | Life of tenant + 30d trash | Stored in S3 private bucket |
| `File` | `uploadedById` | Pseudonymous | Contract (Art 6(1)(b)) | Life of file | Audited owner |

### 2.5 Privacy, Consent & Governance (`ConsentRecord`, `DataExportRequest`, `AccountDeletionRequest`, `TenantLegalHold`, `TenantTombstone`)

| Table | Column | PII Class | Lawful Basis | Retention | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ConsentRecord` | `userId`, `type`, `version`, `ip`, `userAgent` | Legal / Compliance | Legal obligation (Art 6(1)(c)) | 3 years | Evidence of GDPR / DPDP consent acceptance |
| `LegalDocument` | `type`, `version`, `url`, `effectiveAt` | Public Spec | Legal obligation (Art 6(1)(c)) | Permanent | Terms & Privacy versioning |
| `DataExportRequest`| `userId`, `tenantId`, `downloadUrl`, `fileKey` | System / Export | Legal obligation (Art 6(1)(c)) | 7 days | S3 artifacts wiped after 7 days; links expire in 24h |
| `AccountDeletionRequest` | `userId`, `status`, `graceEndsAt` | Lifecycle | Legal obligation (Art 6(1)(c)) | 14-day cooling + 1 year | Tracks grace period and completion |
| `TenantLegalHold` | `tenantId`, `reason`, `placedByStaffId` | Legal / Compliance | Legal obligation (Art 6(1)(c)) | Permanent | Overrides purge and retention sweeps |
| `TenantTombstone` | `tenantId`, `slug`, `name`, `closedAt`, `purgedAt` | Compliance | Legitimate interest (Art 6(1)(f)) | 90 days minimum | Prevents slug recycling and impersonation |

### 2.6 Audit Logs & Security Trails (`AuditLog`, `PlatformAuditLog`)

| Table | Column | PII Class | Lawful Basis | Retention | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `AuditLog` | `actorId`, `actorEmail` | Pseudonymous | Legal obligation / Security | Configurable (90d to 7yr) | Redacted before storage; chained SHA-256 Merkle root |
| `AuditLog` | `ipAddress`, `userAgent` | Pseudonymous | Security (Art 6(1)(f)) | Tenant retention tier | Captures provenance of critical actions |

---

## 3. Data Subject Rights & Lifecycles

### 3.1 Right of Access (DSAR / Export)
- **Endpoint**: `POST /api/v1/users/me/data-export`
- **Output**: Structured JSON manifest packaging profile data, workspace memberships, addresses, file metadata, login events, and consent history.
- **Delivery**: Uploaded to private S3 bucket (`data-exports/user/...`), encrypted at rest via SSE-S3/KMS, signed link expires in 24 hours. Rate-limited to 1 request per 24 hours.

### 3.2 Right to Erasure (Account Deletion & Anonymization)
- **Endpoint**: `POST /api/v1/users/me/delete-request`
- **Cooling Period**: 14 calendar days during which the user may cancel with `POST /api/v1/users/me/delete-request/cancel`.
- **Sole Owner Invariant**: Blocked if the user is the sole `OWNER` of any active workspace. Ownership must be transferred or workspace closed first.
- **Anonymization Execution**:
  1. Revokes all JWT tokens and deletes active sessions (`Session`, `VerificationToken`).
  2. Cleans up personal addresses and membership associations.
  3. Replaces `email` with deterministic tombstone `deleted+<userId>@invalid` to free the original email for re-registration while maintaining referential integrity.
  4. Nullifies `firstName`, `lastName`, `phoneNumber`, `avatarUrl`, `passwordHash`, and 2FA secrets.
  5. Sets `deletedAt` and user status to `DEACTIVATED`.

### 3.3 Workspace Closure & Purge
- **Endpoint**: `POST /api/v1/tenants/:tenantId/close` (Requires `OWNER` / `tenants:close` and typing the exact slug).
- **Grace Period**: 30 calendar days read-only grace period. Can be canceled anytime during the grace period.
- **Purge Execution**:
  1. Respects active legal holds in `TenantLegalHold` (skips purge if hold is active).
  2. Purges tenant rows in reverse topological order according to the `TENANT_TABLES` registry.
  3. Deletes S3 assets under tenant prefix and clears Redis tenant keys.
  4. Records `TenantTombstone` to prevent slug reuse for 90 days.

### 3.4 Automated Retention Sweep
- **Scheduler**: BullMQ cron job `retention-sweep` runs daily at 02:30 UTC.
- **Policies**:
  - Webhook deliveries: 30 days
  - Notifications: 90 days
  - Outbound email delivery logs: 90 days
  - Deleted files in trash: 30 days
  - Expired data export artifacts: 7 days
  - Evaluates legal holds before pruning any workspace data.
