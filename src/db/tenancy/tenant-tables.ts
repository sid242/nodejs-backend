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
  { name: 'FileFolder', table: schema.fileFolders, tenantColumn: 'tenantId' },
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
  { name: 'TenantSetting', table: schema.tenantSettings, tenantColumn: 'tenantId' },
  { name: 'TenantSecurityPolicy', table: schema.tenantSecurityPolicies, tenantColumn: 'tenantId' },
  { name: 'EmailSuppression', table: schema.emailSuppressions, tenantColumn: 'tenantId' },
  { name: 'UsageEvent', table: schema.usageEvents, tenantColumn: 'tenantId' },
  { name: 'UsageDaily', table: schema.usageDaily, tenantColumn: 'tenantId' },
  { name: 'ActivityFeed', table: schema.activityFeed, tenantColumn: 'tenantId' },
  { name: 'ReportDefinition', table: schema.reportDefinitions, tenantColumn: 'tenantId' },

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
  {
    name: 'FileShare',
    table: schema.fileShares,
    tenantColumn: 'tenantId',
    dependsOn: ['File'],
  },
  {
    name: 'FileVersion',
    table: schema.fileVersions,
    tenantColumn: 'tenantId',
    dependsOn: ['File'],
  },
  {
    name: 'EmailTemplateVersion',
    table: schema.emailTemplateVersions,
    tenantColumn: 'tenantId',
    dependsOn: ['EmailTemplate'],
  },
  {
    name: 'EmailMessage',
    table: schema.emailMessages,
    tenantColumn: 'tenantId',
    dependsOn: ['EmailTemplate'],
  },
  {
    name: 'ApiKey',
    table: schema.apiKeys,
    tenantColumn: 'tenantId',
    dependsOn: ['TenantMember'],
  },
  {
    name: 'WebhookEndpoint',
    table: schema.webhookEndpoints,
    tenantColumn: 'tenantId',
    dependsOn: ['TenantMember'],
  },
  {
    name: 'WebhookDelivery',
    table: schema.webhookDeliveries,
    tenantColumn: 'tenantId',
    dependsOn: ['WebhookEndpoint'],
  },
  {
    name: 'ReportRun',
    table: schema.reportRuns,
    tenantColumn: 'tenantId',
    dependsOn: ['ReportDefinition'],
  },
  {
    name: 'OnboardingProgress',
    table: schema.onboardingProgress,
    tenantColumn: 'tenantId',
    dependsOn: [],
  },
  {
    name: 'SupportTicket',
    table: schema.supportTickets,
    tenantColumn: 'tenantId',
    dependsOn: [],
  },
  {
    name: 'SupportTicketMessage',
    table: schema.supportTicketMessages,
    tenantColumn: 'tenantId',
    dependsOn: ['SupportTicket'],
  },
  { name: 'ChatChannel', table: schema.chatChannels, tenantColumn: 'tenantId' },
  {
    name: 'ChatChannelMember',
    table: schema.chatChannelMembers,
    tenantColumn: 'tenantId',
    dependsOn: ['ChatChannel'],
  },
  {
    name: 'ChatMessage',
    table: schema.chatMessages,
    tenantColumn: 'tenantId',
    dependsOn: ['ChatChannel', 'ChatChannelMember'],
  },
  {
    name: 'ChatMessageReaction',
    table: schema.chatMessageReactions,
    tenantColumn: 'tenantId',
    dependsOn: ['ChatMessage', 'ChatChannel', 'ChatChannelMember'],
  },
  {
    name: 'ChatMessageAttachment',
    table: schema.chatMessageAttachments,
    tenantColumn: 'tenantId',
    dependsOn: ['ChatMessage', 'ChatChannel'],
  },
  {
    name: 'ChatMessageMention',
    table: schema.chatMessageMentions,
    tenantColumn: 'tenantId',
    dependsOn: ['ChatMessage', 'ChatChannel', 'ChatChannelMember'],
  },
];

/**
 * Tables that strictly reside in the primary cluster and are not tenant-scoped.
 */
export const PRIMARY_ONLY_TABLES: string[] = [
  'Announcement',
  'AnnouncementDismissal',
  'ChangelogEntry',
  'FeatureFlag',
  'FeatureFlagRule',
  'MaintenanceConfig',
  'Tenant',
  'TenantSlugHistory',
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
  'InvoiceSequence',
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
  'UserGroupPlatformRole',
  'TenantDbOperation',
  'AppModule',
  'Permission',
  'Policy',
  'RolePolicy',
  'GroupPolicy',
  'PlatformRolePolicy',
  'AuditRetentionRun',
  'Notification',
  'NotificationPreference',
  'PushSubscription',
  'UserLoginEvent',
  'ConsentRecord',
  'LegalDocument',
  'DataExportRequest',
  'AccountDeletionRequest',
  'TenantTombstone',
  'TenantLegalHold',
  'PlatformMetricsDaily',
  'FeedbackItem',
  'PlatformChatChannel',
  'PlatformChatChannelMember',
  'PlatformChatMessage',
  'PlatformChatMessageReaction',
  'PlatformChatMessageAttachment',
  'PlatformChatMessageMention',
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
