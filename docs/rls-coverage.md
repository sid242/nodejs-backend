# PostgreSQL Row-Level Security (RLS) & Tenant Isolation Architecture

This document defines the kernel-enforced Row-Level Security (RLS) defense-in-depth model implemented across the multi-tenant architecture.

---

## 1. Threat Model & Invariants

Application-level filtering (`WHERE "tenantId" = ...`) is required on all queries, but software bugs, unverified queries, or third-party ORM edge cases can lead to accidental data leakage.

PostgreSQL Row-Level Security acts as an immutable database-kernel boundary:

1. **Zero-Leakage on Unset Tenant**: If `app.tenant_id` is missing, empty, or uninitialized in a session, queries return **zero rows** by default (`NULLIF(current_setting('app.tenant_id', true), '')::uuid` evaluates to `NULL`, which fails the policy check).
2. **Force RLS**: Every tenant table has `FORCE ROW LEVEL SECURITY` enabled to prevent table owners or elevated application roles from bypassing isolation policies.
3. **No Cross-Tenant Writes**: The `WITH CHECK` expression guarantees that tenant sessions can never insert or update records with a foreign `tenantId`, nor can they create or modify system-level records (`tenantId IS NULL`).
4. **Platform Bypass via Dedicated Role**: Only internal platform operator maintenance tasks running under `app_platform_role` are granted a permissive bypass policy.

---

## 2. PostgreSQL Role Matrix

| Role                | Classification      | Permissions                                                                  | Usage                                                                                   |
| :------------------ | :------------------ | :--------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `app_owner`         | Schema Owner        | `ALL PRIVILEGES`, `SUPERUSER` / `CREATEDB`                                   | CI/CD schema migrations only (`DATABASE_MIGRATION_URL`)                                 |
| `app_runtime`       | Standard Connection | `NOSUPERUSER`, `NOBYPASSRLS`, `SELECT/INSERT/UPDATE/DELETE` on public tables | Standard API & Worker processes (`DATABASE_URL`)                                        |
| `tenant_app_role`   | Transaction Role    | `NOSUPERUSER`, `NOBYPASSRLS`, RLS strictly enforced                          | Switched to locally via `SET LOCAL ROLE tenant_app_role` within `withTenantTransaction` |
| `app_platform_role` | Platform Role       | `NOSUPERUSER`, `NOBYPASSRLS`, RLS bypass policy enabled                      | Switched to locally via `SET LOCAL ROLE app_platform_role` for cross-tenant maintenance |

---

## 3. Tenant Tables RLS Inventory

All 39 tenant-scoped tables registered in `TENANT_TABLES` have RLS enabled, forced, and governed by strict isolation policies:

| Table Name             | Drizzle Export           | Tenant Column | Read Policy (`USING`)                          | Write Policy (`WITH CHECK`) |
| :--------------------- | :----------------------- | :------------ | :--------------------------------------------- | :-------------------------- |
| `TenantBranding`       | `tenantBrandings`        | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `AppRole`              | `roles`                  | `tenantId`    | `tenantId = app.tenant_id OR tenantId IS NULL` | `tenantId = app.tenant_id`  |
| `TenantMember`         | `tenantMembers`          | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantInvitation`     | `tenantInvitations`      | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `FileFolder`           | `fileFolders`            | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `File`                 | `files`                  | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `EmailTemplate`        | `emailTemplates`         | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantEmailConfig`    | `tenantEmailConfigs`     | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `Address`              | `addresses`              | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `UserGroup`            | `userGroups`             | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `AuditLog`             | `auditLogs`              | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantAuditPolicy`    | `tenantAuditPolicies`    | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `tenant_sso_configs`   | `tenantSsoConfigs`       | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `tenant_scim_tokens`   | `tenantScimTokens`       | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantModule`         | `tenantModules`          | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `OutboxEvent`          | `outboxEvents`           | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `Lead`                 | `leads`                  | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantSetting`        | `tenantSettings`         | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantSecurityPolicy` | `tenantSecurityPolicies` | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `EmailSuppression`     | `emailSuppressions`      | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `UsageEvent`           | `usageEvents`            | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `UsageDaily`           | `usageDaily`             | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ActivityFeed`         | `activityFeed`           | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ReportDefinition`     | `reportDefinitions`      | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `RolePermission`       | `rolePermissions`        | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `TenantMemberRole`     | `tenantMemberRoles`      | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `UserGroupMember`      | `userGroupMembers`       | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `UserGroupRole`        | `userGroupRoles`         | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `FileShare`            | `fileShares`             | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `FileVersion`          | `fileVersions`           | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `EmailTemplateVersion` | `emailTemplateVersions`  | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `EmailMessage`         | `emailMessages`          | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ApiKey`               | `apiKeys`                | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `WebhookEndpoint`      | `webhookEndpoints`       | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `WebhookDelivery`      | `webhookDeliveries`      | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ConsentRecord`        | `consentRecords`         | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ExportJob`            | `exportJobs`             | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ExportArtifact`       | `exportArtifacts`        | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |
| `ReportRun`            | `reportRuns`             | `tenantId`    | `tenantId = app.tenant_id`                     | `tenantId = app.tenant_id`  |

---

## 4. Pre-Tenant Lookups Catalog

The following operations execute **before** or **outside** a resolved tenant context. They operate strictly on primary-scoped tables or execute via `primaryDbHandle()`:

1. **Host & Subdomain Resolution (`findTenantByCustomDomain`, `findTenantBySlug`)**:
   - Queries `Tenant` and `TenantBranding` (primary cluster replica).
2. **User Authentication & Session Validation (`findUserByEmail`, `findSessionById`)**:
   - Queries `User` and `Session` (primary cluster).
3. **Invitation Verification by Token (`findInvitationByToken`)**:
   - Invitation tokens are looked up on primary cluster before the accepting user becomes a tenant member.
4. **Enterprise SSO ACS & SAML Assertion Verification (`findSsoConfigByEntityId`, `findTenantBySsoDomain`)**:
   - Pre-login discovery queries the primary SSO registry by IdP Entity ID or email domain.
5. **SCIM Token Authentication (`findTenantByScimToken`)**:
   - SCIM HTTP Authorization header resolves tenant mapping from the primary SCIM token registry.
6. **Support Delegation Session Handshake (`findSupportSessionById`)**:
   - Audited support sessions resolve through `PlatformSupportSession` (primary cluster).
