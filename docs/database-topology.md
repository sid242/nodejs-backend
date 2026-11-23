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

- `tenants` (`Tenant`): Organization registry and database connection metadata.
- `tenant_brandings` (`TenantBranding`): Organization themes & logos needed pre-login for custom domain/subdomain resolution.
- `tenant_secrets` (`tenant_secrets`): Encrypted credentials and secret references.
- `users` (`User`): Central user accounts and credentials across all workspaces.
- `sessions` (`Session`): Active login sessions and device identifiers.
- `verification_tokens` (`VerificationToken`): Password reset and email confirmation tokens.
- `plans` (`Plan`), `plan_features` (`PlanFeature`), `plan_tiers` (`PlanTier`): SaaS catalog and billing tier definitions.
- `subscriptions` (`Subscription`), `subscription_events` (`SubscriptionEvent`), `invoices` (`Invoice`), `payments` (`Payment`), `refunds` (`Refund`): Billing and revenue control plane.
- `platform_staff` (`PlatformStaff`), `platform_roles` (`PlatformRole`), `platform_audit_logs` (`PlatformAuditLog`), `platform_support_sessions` (`PlatformSupportSession`): Internal operations and backoffice operator auditing.
- `app_modules` (`AppModule`), `permissions` (`Permission`): System application module definitions and global permissions.

### Tenant DB Always (Shared or Dedicated)

- `leads` (`Lead`): CRM leads and sales pipeline.
- `tenant_members` (`TenantMember`): Workspace memberships.
- `tenant_member_roles` (`TenantMemberRole`): Role assignments to tenant members.
- `roles` (`AppRole`): Custom tenant roles (system roles replicated or inherited).
- `role_permissions` (`RolePermission`): Permissions granted to custom tenant roles.
- `tenant_invitations` (`TenantInvitation`): Outstanding invitations to join an organization.
- `files` (`File`): Uploaded files and S3 asset metadata.
- `email_templates` (`EmailTemplate`): Tenant-customized notification templates.
- `tenant_email_configs` (`TenantEmailConfig`): Custom SMTP / SES delivery settings.
- `addresses` (`Address`): Tenant and member physical addresses.
- `user_groups` (`UserGroup`), `user_group_members` (`UserGroupMember`), `user_group_roles` (`UserGroupRole`): Organization teams, user groups, and group role bindings.
- `audit_logs` (`AuditLog`): Tenant security and compliance audit trail.
- `tenant_audit_policies` (`TenantAuditPolicy`): Retention policies and export flags.
- `tenant_sso_configs` (`TenantSsoConfig`), `tenant_scim_tokens` (`TenantScimToken`): Enterprise SSO SAML/OIDC and SCIM tokens.
- `tenant_modules` (`TenantModule`): Organization module activation toggles.
- `outbox_events` (`OutboxEvent`): Tenant-scoped transactional outbox events.

---

## 3. Invariants & Rules

1. **No Cross-Database SQL Joins**: Under dedicated mode, tables in Tenant DB cannot execute SQL `JOIN`s against tables in Primary DB (e.g. `User`). Applications must use `attachUsers()` to fetch records from Tenant DB and batch-enrich with profile data from Primary DB.
2. **Dynamic Context Execution**: Tenant repositories must use `tenantDb()` for tenant-owned queries, which dynamically routes to the request's connection pool via `AsyncLocalStorage`.
3. **Write Isolation Guards**: All tenant write operations must invoke `assertTenantScope(tenantId)` to prevent cross-tenant writes within a single context.
