/**
 * Canonical platform permission keys adhering to the strict `resource::action` naming standard.
 * Platform permissions govern internal SaaS staff operations, distinct from tenant-user permissions.
 */
export const PLATFORM_PERMISSIONS = {
  // Platform Staff Management
  STAFF_READ: 'platform_staff::read',
  STAFF_CREATE: 'platform_staff::create',
  STAFF_UPDATE: 'platform_staff::update',
  STAFF_DISABLE: 'platform_staff::disable',

  // Platform Roles & Permissions Catalog
  ROLES_READ: 'platform_roles::read',
  ROLES_MANAGE: 'platform_roles::manage',
  PERMISSIONS_READ: 'platform_permissions::read',

  // Platform User Administration
  USERS_READ: 'platform_users::read',
  USERS_UPDATE: 'platform_users::update',
  USERS_SUSPEND: 'platform_users::suspend',

  // RBAC Catalog Management
  RBAC_CATALOG_MANAGE: 'rbac_catalog::manage',

  // Tenant Lifecycle Oversight
  TENANTS_READ: 'tenants::read',
  TENANTS_CREATE: 'tenants::create',
  TENANTS_MANAGE: 'tenants::manage',
  TENANTS_SUSPEND: 'tenants::suspend',

  // Audited Customer Support Delegation
  SUPPORT_START: 'tenant_support::start',
  SUPPORT_END: 'tenant_support::end',
  SUPPORT_WRITE: 'tenant_support::write',
  SUPPORT_IMPERSONATE: 'tenant_support::impersonate',
  SUPPORT_END_ANY: 'tenant_support::end_any',

  // Billing & Subscriptions
  BILLING_READ: 'billing::read',
  BILLING_MANAGE: 'billing::manage',

  // Audit Logs & Diagnostics
  AUDIT_READ: 'platform_audit::read',
  HEALTH_READ: 'system_health::read',
} as const;

export type PlatformPermissionKey =
  (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

export interface PlatformPermissionDefinition {
  key: PlatformPermissionKey;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export const PLATFORM_PERMISSION_CATALOGUE: PlatformPermissionDefinition[] = [
  {
    key: PLATFORM_PERMISSIONS.STAFF_READ,
    name: 'View Platform Staff',
    description: 'Inspect internal SaaS staff directory, status, and assigned roles',
    resource: 'platform_staff',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.STAFF_CREATE,
    name: 'Create Platform Staff',
    description: 'Invite or provision new internal SaaS platform staff members',
    resource: 'platform_staff',
    action: 'create',
  },
  {
    key: PLATFORM_PERMISSIONS.STAFF_UPDATE,
    name: 'Update Platform Staff',
    description: 'Modify staff profiles, status, or assigned platform role',
    resource: 'platform_staff',
    action: 'update',
  },
  {
    key: PLATFORM_PERMISSIONS.STAFF_DISABLE,
    name: 'Disable Platform Staff',
    description: 'Immediately revoke staff access and suspend active sessions',
    resource: 'platform_staff',
    action: 'disable',
  },
  {
    key: PLATFORM_PERMISSIONS.ROLES_READ,
    name: 'View Platform Roles',
    description: 'List internal platform staff roles and effective permissions',
    resource: 'platform_roles',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.ROLES_MANAGE,
    name: 'Manage Platform Roles',
    description: 'Create, update, or configure permission grants for platform roles',
    resource: 'platform_roles',
    action: 'manage',
  },
  {
    key: PLATFORM_PERMISSIONS.PERMISSIONS_READ,
    name: 'View Permission Catalogue',
    description: 'Inspect canonical resource::action permissions catalogue',
    resource: 'platform_permissions',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.TENANTS_READ,
    name: 'View All Tenants',
    description: 'Inspect customer tenant metadata, database modes, and plans',
    resource: 'tenants',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.TENANTS_MANAGE,
    name: 'Manage & Provision Tenants',
    description:
      'Provision new tenant workspaces, configure database modes, or update tenant metadata',
    resource: 'tenants',
    action: 'manage',
  },
  {
    key: PLATFORM_PERMISSIONS.TENANTS_SUSPEND,
    name: 'Suspend/Reactivate Tenants',
    description: 'Change tenant operational status between active and suspended',
    resource: 'tenants',
    action: 'suspend',
  },
  {
    key: PLATFORM_PERMISSIONS.SUPPORT_START,
    name: 'Initiate Tenant Support Session',
    description: 'Start a time-bound, purpose-limited, audited customer support session',
    resource: 'tenant_support',
    action: 'start',
  },
  {
    key: PLATFORM_PERMISSIONS.SUPPORT_END,
    name: 'Terminate Tenant Support Session',
    description: 'Explicitly end an active support session and record the outcome',
    resource: 'tenant_support',
    action: 'end',
  },
  {
    key: PLATFORM_PERMISSIONS.BILLING_READ,
    name: 'View Billing & Subscriptions',
    description: 'Inspect tenant subscription tiers, invoices, and payment statuses',
    resource: 'billing',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.BILLING_MANAGE,
    name: 'Manage Billing Configurations',
    description: 'Modify subscription plans, apply billing credits, or update payment config',
    resource: 'billing',
    action: 'manage',
  },
  {
    key: PLATFORM_PERMISSIONS.AUDIT_READ,
    name: 'View Platform Audit Trail',
    description: 'Query security and compliance audit records across the platform',
    resource: 'platform_audit',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.HEALTH_READ,
    name: 'View System Health & Diagnostics',
    description:
      'Inspect operational health checks, BullMQ queue status, and container diagnostics',
    resource: 'system_health',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.USERS_READ,
    name: 'View Global Users',
    description: 'Inspect global user identities, verification statuses, and activity',
    resource: 'platform_users',
    action: 'read',
  },
  {
    key: PLATFORM_PERMISSIONS.USERS_UPDATE,
    name: 'Update Global Users',
    description: 'Modify user profiles and metadata',
    resource: 'platform_users',
    action: 'update',
  },
  {
    key: PLATFORM_PERMISSIONS.USERS_SUSPEND,
    name: 'Suspend Global Users',
    description: 'Suspend or deactivate global customer user accounts',
    resource: 'platform_users',
    action: 'suspend',
  },
  {
    key: PLATFORM_PERMISSIONS.RBAC_CATALOG_MANAGE,
    name: 'Manage System RBAC Catalog',
    description: 'Create, update, or remove system domain modules and default permissions',
    resource: 'rbac_catalog',
    action: 'manage',
  },
  {
    key: PLATFORM_PERMISSIONS.TENANTS_CREATE,
    name: 'Provision Tenants',
    description: 'Create and provision new tenant workspaces',
    resource: 'tenants',
    action: 'create',
  },
  {
    key: PLATFORM_PERMISSIONS.SUPPORT_WRITE,
    name: 'Full Support Access',
    description: 'Execute write operations during an active tenant support delegation session',
    resource: 'tenant_support',
    action: 'write',
  },
  {
    key: PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE,
    name: 'Impersonate Tenant Member',
    description: 'Act as a specific tenant member within an audited support session',
    resource: 'tenant_support',
    action: 'impersonate',
  },
  {
    key: PLATFORM_PERMISSIONS.SUPPORT_END_ANY,
    name: 'End Any Support Session',
    description: 'Terminate any active support session across the platform',
    resource: 'tenant_support',
    action: 'end_any',
  },
];

export const SYSTEM_PLATFORM_ROLES = {
  SUPER_ADMIN: {
    key: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Full unconstrained platform control, staff lifecycle, security, and settings',
    permissions: Object.values(PLATFORM_PERMISSIONS),
  },
  SUPPORT_STAFF: {
    key: 'SUPPORT_STAFF',
    name: 'Customer Support Staff',
    description:
      'View tenant metadata, manage tickets, initiate controlled tenant support sessions',
    permissions: [
      PLATFORM_PERMISSIONS.TENANTS_READ,
      PLATFORM_PERMISSIONS.USERS_READ,
      PLATFORM_PERMISSIONS.SUPPORT_START,
      PLATFORM_PERMISSIONS.SUPPORT_END,
      PLATFORM_PERMISSIONS.SUPPORT_WRITE,
      PLATFORM_PERMISSIONS.AUDIT_READ,
      PLATFORM_PERMISSIONS.HEALTH_READ,
    ],
  },
  BILLING_STAFF: {
    key: 'BILLING_STAFF',
    name: 'Billing & Finance Staff',
    description: 'Manage subscription tiers, invoices, and billing configurations',
    permissions: [
      PLATFORM_PERMISSIONS.TENANTS_READ,
      PLATFORM_PERMISSIONS.BILLING_READ,
      PLATFORM_PERMISSIONS.BILLING_MANAGE,
      PLATFORM_PERMISSIONS.AUDIT_READ,
    ],
  },
  TECHNICAL_SUPPORT: {
    key: 'TECHNICAL_SUPPORT',
    name: 'Technical Operations & Support',
    description: 'Inspect system health, diagnostics, job queues, and time-bound troubleshooting',
    permissions: [
      PLATFORM_PERMISSIONS.HEALTH_READ,
      PLATFORM_PERMISSIONS.TENANTS_READ,
      PLATFORM_PERMISSIONS.SUPPORT_START,
      PLATFORM_PERMISSIONS.SUPPORT_END,
    ],
  },
  READ_ONLY_AUDITOR: {
    key: 'READ_ONLY_AUDITOR',
    name: 'Compliance & Security Auditor',
    description: 'Read-only access to audit logs, staff rosters, roles, and compliance records',
    permissions: [
      PLATFORM_PERMISSIONS.AUDIT_READ,
      PLATFORM_PERMISSIONS.STAFF_READ,
      PLATFORM_PERMISSIONS.ROLES_READ,
      PLATFORM_PERMISSIONS.PERMISSIONS_READ,
      PLATFORM_PERMISSIONS.TENANTS_READ,
      PLATFORM_PERMISSIONS.BILLING_READ,
      PLATFORM_PERMISSIONS.HEALTH_READ,
    ],
  },
} as const;
