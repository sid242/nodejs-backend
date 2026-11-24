# Database Topology & Scope Reference

This document defines the architectural division of data across the database topology in this multi-tenant system.

---

## 1. Scope Definitions

| Scope                  | Physical Location                                                                                                  | Rationale                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary (Registry)** | Central Primary PostgreSQL cluster                                                                                 | Global data needed before tenant identity is resolved, cross-tenant records, billing control plane, staff administration, and central identity/authentication.         |
| **Tenant**             | Tenant Database (Primary if `databaseMode = 'shared'`, dedicated isolated cluster if `databaseMode = 'dedicated'`) | Enterprise tenant business data, members, custom roles, uploaded assets, audit logs, and configuration. Provides complete data isolation for dedicated tier customers. |

---

## 2. Table-to-Scope Mapping

### Primary DB Always

The following tables strictly reside in the central primary cluster (`PRIMARY_ONLY_TABLES`):

- `tenants` (`Tenant`), `tenant_slug_history` (`TenantSlugHistory`): Organization registry and routing metadata.
- `tenant_brandings` (`TenantBranding`): Organization themes & logos needed pre-login for custom domain/subdomain resolution (cached/replicated).
- `tenant_secrets` (`tenant_secrets`): Encrypted credentials and secret references.
- `users` (`User`), `sessions` (`Session`), `verification_tokens` (`VerificationToken`): Central user identity, login sessions, and auth verification.
- `plans` (`Plan`), `plan_features` (`PlanFeature`), `plan_tiers` (`PlanTier`): Global subscription catalog and billing tiers.
- `subscriptions` (`Subscription`), `subscription_events` (`SubscriptionEvent`), `invoices` (`Invoice`), `payments` (`Payment`), `refunds` (`Refund`): Billing and financial control plane.
- `platform_staff` (`PlatformStaff`), `platform_roles` (`PlatformRole`), `platform_audit_logs` (`PlatformAuditLog`), `platform_support_sessions` (`PlatformSupportSession`): Backoffice staff, canonical RBAC, and support delegation.
- `app_modules` (`AppModule`), `permissions` (`Permission`): System application module definitions and global permissions.
- `announcements` (`Announcement`), `announcement_dismissals` (`AnnouncementDismissal`), `changelog_entries` (`ChangelogEntry`): System-wide announcements and release notes.
- `feature_flags` (`FeatureFlag`), `feature_flag_rules` (`FeatureFlagRule`): Dynamic feature flagging and rollout controls.
- `maintenance_configs` (`MaintenanceConfig`): System maintenance windows.
- `consent_records` (`ConsentRecord`), `export_jobs` (`ExportJob`), `export_artifacts` (`ExportArtifact`): Global privacy compliance and GDPR export jobs.

### Tenant DB Always (Shared or Dedicated)

All 39 tenant-scoped tables registered in `TENANT_TABLES` (`src/db/tenancy/tenant-tables.ts`) reside in the tenant's assigned database (shared schema or dedicated cluster):

1. **Identity, Membership & Access Control**:
   - `TenantMember` (`tenantMembers`), `TenantMemberRole` (`tenantMemberRoles`), `TenantInvitation` (`tenantInvitations`)
   - `AppRole` (`roles`), `RolePermission` (`rolePermissions`)
   - `UserGroup` (`userGroups`), `UserGroupMember` (`userGroupMembers`), `UserGroupRole` (`userGroupRoles`)
   - `tenant_sso_configs` (`tenantSsoConfigs`), `tenant_scim_tokens` (`tenantScimTokens`)
2. **Branding, Communication & Content**:
   - `TenantBranding` (`tenantBrandings`)
   - `EmailTemplate` (`emailTemplates`), `EmailTemplateVersion` (`emailTemplateVersions`), `EmailMessage` (`emailMessages`), `TenantEmailConfig` (`tenantEmailConfigs`), `EmailSuppression` (`emailSuppressions`)
   - `FileFolder` (`fileFolders`), `File` (`files`), `FileVersion` (`fileVersions`), `FileShare` (`fileShares`)
3. **CRM, Operations & Support**:
   - `Lead` (`leads`)
   - `OnboardingProgress` (`onboardingProgress`)
   - `SupportTicket` (`supportTickets`), `SupportTicketMessage` (`supportTicketMessages`)
   - `Address` (`addresses`)
4. **Developer APIs & Integrations**:
   - `ApiKey` (`apiKeys`)
   - `WebhookEndpoint` (`webhookEndpoints`), `WebhookDelivery` (`webhookDeliveries`)
   - `OutboxEvent` (`outboxEvents`)
5. **Auditing, Analytics & Settings**:
   - `AuditLog` (`auditLogs`), `TenantAuditPolicy` (`tenantAuditPolicies`)
   - `ActivityFeed` (`activityFeed`)
   - `UsageEvent` (`usageEvents`), `UsageDaily` (`usageDaily`)
   - `ReportDefinition` (`reportDefinitions`), `ReportRun` (`reportRuns`)
   - `TenantSetting` (`tenantSettings`), `TenantSecurityPolicy` (`tenantSecurityPolicies`), `TenantModule` (`tenantModules`)

---

## 3. Invariants & Rules

1. **No Cross-Database SQL Joins**: Under dedicated mode, tables in Tenant DB cannot execute SQL `JOIN`s against tables in Primary DB (e.g. `User`). Applications must use `attachUsers()` to fetch records from Tenant DB and batch-enrich with profile data from Primary DB.
2. **Dynamic Context Execution**: Tenant repositories must use `tenantDb()` for tenant-owned queries, which dynamically routes to the request's connection pool via `AsyncLocalStorage`.
3. **Write Isolation Guards**: All tenant write operations must invoke `assertTenantScope(tenantId)` to prevent cross-tenant writes within a single context.
4. **Runtime RLS Enforcement**: Shared-database tenants can be enrolled in transaction-level RLS enforcement via `RLS_ENFORCEMENT_PILOT_TENANTS`. When active, requests execute inside `withTenantTransaction` with `SET LOCAL ROLE tenant_app_role` and `SET LOCAL app.tenant_id = '<id>'`, preventing data access across tenant boundaries even if queries omit `tenantId` filters.
