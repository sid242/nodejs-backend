import { type PgTable } from 'drizzle-orm/pg-core';

import * as schema from '@/db/schema';

export interface TenantTableRegistration {
  name: string; // Database table name
  table: PgTable;
  tenantColumn: string;
  dependsOn?: string[];
}

/**
 * Ordered registry of every tenant-scoped table in topological order.
 * Tables earlier in the list do not depend on tables later in the list.
 */
export const TENANT_TABLES: TenantTableRegistration[] = [
  // Level 0: Independent tenant tables
  { name: 'TenantBranding', table: schema.tenantBrandings, tenantColumn: 'tenantId' },
  { name: 'AppRole', table: schema.roles, tenantColumn: 'tenantId' },
  { name: 'TenantMember', table: schema.tenantMembers, tenantColumn: 'tenantId' },
  { name: 'TenantInvitation', table: schema.tenantInvitations, tenantColumn: 'tenantId' },
  { name: 'File', table: schema.files, tenantColumn: 'tenantId' },
  { name: 'EmailTemplate', table: schema.emailTemplates, tenantColumn: 'tenantId' },
  { name: 'TenantEmailConfig', table: schema.tenantEmailConfigs, tenantColumn: 'tenantId' },
  { name: 'Address', table: schema.addresses, tenantColumn: 'tenantId' },
  { name: 'UserGroup', table: schema.userGroups, tenantColumn: 'tenantId' },
  { name: 'AuditLog', table: schema.auditLogs, tenantColumn: 'tenantId' },
  { name: 'TenantAuditPolicy', table: schema.tenantAuditPolicies, tenantColumn: 'tenantId' },
  { name: 'tenant_sso_configs', table: schema.tenantSsoConfigs, tenantColumn: 'tenantId' },
  { name: 'tenant_scim_tokens', table: schema.tenantScimTokens, tenantColumn: 'tenantId' },
  { name: 'TenantModule', table: schema.tenantModules, tenantColumn: 'tenantId' },
  { name: 'OutboxEvent', table: schema.outboxEvents, tenantColumn: 'tenantId' },
  { name: 'Lead', table: schema.leads, tenantColumn: 'tenantId' },

  // Level 1: Dependent on Level 0
  {
    name: 'RolePermission',
    table: schema.rolePermissions,
    tenantColumn: 'tenantId',
    dependsOn: ['AppRole'],
  },
  {
    name: 'TenantMemberRole',
    table: schema.tenantMemberRoles,
    tenantColumn: 'tenantId',
    dependsOn: ['TenantMember', 'AppRole'],
  },
  {
    name: 'UserGroupMember',
    table: schema.userGroupMembers,
    tenantColumn: 'tenantId',
    dependsOn: ['UserGroup'],
  },
  {
    name: 'UserGroupRole',
    table: schema.userGroupRoles,
    tenantColumn: 'tenantId',
    dependsOn: ['UserGroup', 'AppRole'],
  },
];

/**
 * Tables that strictly reside in the primary cluster and are not tenant-scoped.
 */
export const PRIMARY_ONLY_TABLES: string[] = [
  'Tenant',
  'tenant_secrets',
  'User',
  'Session',
  'VerificationToken',
  'Plan',
  'PlanModule',
  'Subscription',
  'SubscriptionEvent',
  'SubscriptionChange',
  'Invoice',
  'Payment',
  'Refund',
  'BillingWebhook',
  'EntitlementDefinition',
  'PlanEntitlement',
  'TenantEntitlementOverride',
  'TenantUsageRecord',
  'PlatformStaff',
  'PlatformRole',
  'PlatformRolePermission',
  'PlatformPermission',
  'PlatformAuditLog',
  'PlatformSupportSession',
  'PlatformUserGroup',
  'PlatformUserGroupMember',
  'PlatformUserGroupRole',
  'TenantDbOperation',
  'AppModule',
  'Permission',
  'Policy',
  'RolePolicy',
  'PlatformRolePolicy',
  'AuditRetentionRun',
];

const tenantTableMap = new Map<string, TenantTableRegistration>(
  TENANT_TABLES.map((t) => [t.name, t]),
);

export function isTenantTable(tableName: string): boolean {
  return tenantTableMap.has(tableName);
}

export function getTenantTable(name: string): TenantTableRegistration | undefined {
  return tenantTableMap.get(name);
}
