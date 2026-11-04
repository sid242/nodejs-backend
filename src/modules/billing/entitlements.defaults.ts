export interface DefaultEntitlementDefinition {
  key: string;
  label: string;
  description: string;
  type: 'INTEGER' | 'BOOLEAN' | 'STRING';
  unit?: string;
  validation?: { min?: number; max?: number; regex?: string };
  defaultValue: any;
}

export const DEFAULT_ENTITLEMENT_DEFINITIONS: DefaultEntitlementDefinition[] = [
  {
    key: 'members.max',
    label: 'Maximum Team Members',
    description: 'The maximum number of active workspace members and pending invites allowed.',
    type: 'INTEGER',
    unit: 'members',
    validation: { min: 1, max: 100000 },
    defaultValue: 5,
  },
  {
    key: 'storage.gb',
    label: 'Cloud Storage Capacity',
    description: 'Total cloud file storage quota allocated to the workspace in gigabytes.',
    type: 'INTEGER',
    unit: 'GB',
    validation: { min: 1, max: 10000 },
    defaultValue: 1,
  },
  {
    key: 'groups.enabled',
    label: 'User Groups & Teams',
    description: 'Whether the workspace can create and manage user groups for dynamic RBAC.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'custom_domains.max',
    label: 'Custom Domains',
    description: 'Maximum number of verified custom domains allowed for white-label access.',
    type: 'INTEGER',
    unit: 'domains',
    validation: { min: 0, max: 50 },
    defaultValue: 0,
  },
  {
    key: 'audit.retention_days',
    label: 'Audit Log Retention',
    description: 'Number of days audit logs are retained and queryable in compliance exports.',
    type: 'INTEGER',
    unit: 'days',
    validation: { min: 7, max: 3650 },
    defaultValue: 30,
  },
  {
    key: 'api_access.enabled',
    label: 'API & Webhook Access',
    description: 'Enables external developer API access and automated outbound webhook integrations.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'branding.remove_watermark',
    label: 'Remove Platform Watermark',
    description: 'Allows hiding platform branding and "Powered by" badges on customer-facing auth and workspace portals.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'branding.custom_colors',
    label: 'Custom Theme & Brand Palette',
    description: 'Enables advanced custom palette configuration, dual-theme dark colors, and custom typography.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'sso.saml',
    label: 'Enterprise SSO (SAML 2.0 / OIDC)',
    description: 'Enables SAML 2.0 and OpenID Connect enterprise identity provider integration with domain routing.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'sso.scim',
    label: 'SCIM 2.0 Directory Sync',
    description: 'Enables automated user provisioning, deprovisioning, and group synchronization via SCIM 2.0 protocol.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'audit.export',
    label: 'Audit Trail Export',
    description: 'Allows exporting filtered audit logs and security trails to CSV or JSON for compliance archival.',
    type: 'BOOLEAN',
    defaultValue: false,
  },
];

export const DEFAULT_PLAN_ENTITLEMENT_VALUES: Record<string, Record<string, any>> = {
  FREE: {
    'members.max': 5,
    'storage.gb': 1,
    'groups.enabled': false,
    'custom_domains.max': 0,
    'audit.retention_days': 14,
    'audit.export': false,
    'api_access.enabled': false,
    'branding.remove_watermark': false,
    'branding.custom_colors': false,
    'sso.saml': false,
    'sso.scim': false,
  },
  PRO: {
    'members.max': 25,
    'storage.gb': 20,
    'groups.enabled': true,
    'custom_domains.max': 1,
    'audit.retention_days': 90,
    'audit.export': true,
    'api_access.enabled': true,
    'branding.remove_watermark': true,
    'branding.custom_colors': true,
    'sso.saml': false,
    'sso.scim': false,
  },
  ENTERPRISE: {
    'members.max': 500,
    'storage.gb': 500,
    'groups.enabled': true,
    'custom_domains.max': 10,
    'audit.retention_days': 365,
    'audit.export': true,
    'api_access.enabled': true,
    'branding.remove_watermark': true,
    'branding.custom_colors': true,
    'sso.saml': true,
    'sso.scim': true,
  },
};

