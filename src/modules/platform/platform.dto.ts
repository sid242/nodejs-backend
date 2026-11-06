import { z } from 'zod';

import { tenantSlugSchema } from '@/modules/tenants/tenants.dto';

// ==========================================
// Platform Staff DTOs
// ==========================================

export const listStaffQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(), // alias for search
  department: z.string().trim().optional(),
  employeeCode: z.string().trim().optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  roleId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z
    .enum(['displayName', 'email', 'employeeCode', 'department', 'status', 'lastLoginAt', 'createdAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type ListStaffQueryDto = z.infer<typeof listStaffQueryDto>;

export const createStaffDto = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(100),
  roleId: z.string().uuid(),
  employeeCode: z.string().trim().max(50).optional(),
  department: z.string().trim().max(100).optional(),
  jobTitle: z.string().trim().max(100).optional(),
});
export type CreateStaffDto = z.infer<typeof createStaffDto>;

export const inviteStaffDto = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(100),
  roleId: z.string().uuid(),
  employeeCode: z.string().trim().max(50).optional(),
  department: z.string().trim().max(100).optional(),
  jobTitle: z.string().trim().max(100).optional(),
  invitationMessage: z.string().trim().max(500).optional(),
});
export type InviteStaffDto = z.infer<typeof inviteStaffDto>;

export const acceptStaffInviteDto = z.object({
  token: z.string().min(16),
  password: z.string().min(8).max(100),
});
export type AcceptStaffInviteDto = z.infer<typeof acceptStaffInviteDto>;

export const loginStaffDto = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginStaffDto = z.infer<typeof loginStaffDto>;

export const updateStaffDto = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  employeeCode: z.string().trim().max(50).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  jobTitle: z.string().trim().max(100).nullable().optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  roleId: z.string().uuid().optional(),
});
export type UpdateStaffDto = z.infer<typeof updateStaffDto>;

export const suspendStaffDto = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
});
export type SuspendStaffDto = z.infer<typeof suspendStaffDto>;

export const resetStaffPasswordDto = z.object({
  newPassword: z.string().min(8).max(100).optional(),
});
export type ResetStaffPasswordDto = z.infer<typeof resetStaffPasswordDto>;

// ==========================================
// Platform Roles & Permissions DTOs
// ==========================================

export const createPlatformRoleDto = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[A-Z_]+$/, 'Role key must be uppercase letters and underscores'),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional(),
  permissionKeys: z.array(z.string()).min(1),
});
export type CreatePlatformRoleDto = z.infer<typeof createPlatformRoleDto>;

export const updatePlatformRoleDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
  permissionKeys: z.array(z.string()).optional(),
});
export type UpdatePlatformRoleDto = z.infer<typeof updatePlatformRoleDto>;

export const startSupportSessionDto = z.object({
  mode: z.enum(['TENANT_SCOPED', 'AS_MEMBER']).default('TENANT_SCOPED'),
  scope: z.enum(['READ_ONLY', 'FULL']).default('READ_ONLY'),
  targetMemberId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  reason: z.string().trim().min(5).max(500),
  ticketRef: z.string().trim().min(1).max(100).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(120).default(30),
  acknowledgement: z.boolean().default(true),
});
export type StartSupportSessionDto = z.infer<typeof startSupportSessionDto>;

export const endSupportSessionDto = z.object({
  outcome: z.string().trim().max(500).optional(),
});
export type EndSupportSessionDto = z.infer<typeof endSupportSessionDto>;

export const listSupportSessionsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tenantId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  ticketRef: z.string().optional(),
  search: z.string().optional(),
});
export type ListSupportSessionsQueryDto = z.infer<typeof listSupportSessionsQueryDto>;

// ==========================================
// Platform Audit Log Query DTOs
// ==========================================

export const queryPlatformAuditLogsDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actorStaffId: z.string().uuid().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});
export type QueryPlatformAuditLogsDto = z.infer<typeof queryPlatformAuditLogsDto>;

// ==========================================
// Platform Tenant Lifecycle & Provisioning DTOs
// ==========================================

export const listPlatformTenantsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIALING', 'DEACTIVATED']).optional(),
  provisioningStatus: z
    .enum(['PENDING', 'PROVISIONING', 'ACTIVE', 'FAILED', 'SUSPENDED', 'DEACTIVATED'])
    .optional(),
  country: z.string().trim().optional(),
  region: z.string().trim().optional(),
  plan: z.string().trim().optional(),
  databaseMode: z.enum(['shared', 'dedicated']).optional(),
  sortBy: z
    .enum([
      'name',
      'slug',
      'legalName',
      'tenantCode',
      'status',
      'plan',
      'createdAt',
      'trialEndsAt',
    ])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type ListPlatformTenantsQueryDto = z.infer<typeof listPlatformTenantsQueryDto>;

export const provisionTenantDto = z.object({
  // 1. Organization
  name: z.string().trim().min(2).max(100),
  slug: tenantSlugSchema,
  legalName: z.string().trim().max(200).optional(),
  tenantCode: z
    .string()
    .trim()
    .max(50)
    .regex(
      /^[A-Z0-9_-]+$/,
      'Tenant code must contain only uppercase letters, numbers, hyphens, and underscores',
    )
    .optional(),
  country: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  timezone: z.string().trim().default('UTC'),
  locale: z.string().trim().default('en-US'),
  currency: z.string().trim().default('USD'),
  supportEmail: z.string().trim().email().optional(),
  supportPhone: z.string().trim().max(30).optional(),
  billingEmail: z.string().trim().email().optional(),
  internalNote: z.string().trim().max(1000).optional(),

  // 2. Initial Owner
  ownerEmail: z.string().trim().email(),
  ownerFirstName: z.string().trim().max(50).optional(),
  ownerLastName: z.string().trim().max(50).optional(),

  // 3. Subscription
  plan: z.string().trim().default('FREE'),
  trialDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(500).optional(),

  // 4. Branding
  branding: z
    .object({
      displayName: z.string().trim().max(100).optional(),
      logoUrl: z.string().trim().url().optional(),
      faviconUrl: z.string().trim().url().optional(),
      primaryColor: z
        .string()
        .trim()
        .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Invalid hex color')
        .optional(),
      secondaryColor: z
        .string()
        .trim()
        .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Invalid hex color')
        .optional(),
    })
    .optional(),

  // 5. Platform-only Infrastructure
  databaseMode: z.enum(['shared', 'dedicated']).default('shared'),
  databaseConfig: z
    .object({
      databaseName: z.string().trim().max(63).optional(),
      poolLimit: z.coerce.number().int().min(1).max(50).default(5).optional(),
      databaseKey: z.string().trim().max(100).optional(),
      connectionUrl: z.string().trim().url().or(z.literal('')).optional(),
    })
    .optional(),
});
export type ProvisionTenantDto = z.infer<typeof provisionTenantDto>;
export type ProvisionTenantInput = z.input<typeof provisionTenantDto>;

export const updatePlatformTenantDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  legalName: z.string().trim().max(200).optional(),
  tenantCode: z
    .string()
    .trim()
    .max(50)
    .regex(
      /^[A-Z0-9_-]+$/,
      'Tenant code must contain only uppercase letters, numbers, hyphens, and underscores',
    )
    .optional(),
  country: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  timezone: z.string().trim().optional(),
  locale: z.string().trim().optional(),
  currency: z.string().trim().optional(),
  supportEmail: z.string().trim().email().optional(),
  supportPhone: z.string().trim().max(30).optional(),
  billingEmail: z.string().trim().email().optional(),
  internalNote: z.string().trim().max(1000).optional(),
  plan: z.string().trim().optional(),
  databaseMode: z.enum(['shared', 'dedicated']).optional(),
  trialEndsAt: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});
export type UpdatePlatformTenantDto = z.infer<typeof updatePlatformTenantDto>;

export const retryProvisioningDto = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RetryProvisioningDto = z.infer<typeof retryProvisioningDto>;

export const closeTenantDto = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CloseTenantDto = z.infer<typeof closeTenantDto>;

export const suspendTenantDto = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type SuspendTenantDto = z.infer<typeof suspendTenantDto>;

export const activateTenantDto = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type ActivateTenantDto = z.infer<typeof activateTenantDto>;

export const updatePlatformTenantSubscriptionDto = z.object({
  planId: z.string().uuid().optional(),
  seatCount: z.coerce.number().int().min(1).optional(),
  status: z.enum(['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED']).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
});
export type UpdatePlatformTenantSubscriptionDto = z.infer<
  typeof updatePlatformTenantSubscriptionDto
>;

export const migrateTenantDatabaseDto = z.object({
  customDatabaseName: z.string().trim().max(63).optional(),
  poolLimit: z.coerce.number().int().min(1).max(50).default(5).optional(),
  connectionUrl: z.string().trim().url().optional(),
});
export type MigrateTenantDatabaseDto = z.infer<typeof migrateTenantDatabaseDto>;

export const listTenantDatabasesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  tenantId: z.string().uuid().optional(),
  strategy: z.enum(['shared', 'dedicated', 'ALL']).optional(),
  provisioningStatus: z
    .enum(['ACTIVE', 'PENDING', 'PROVISIONING', 'FAILED', 'SUSPENDED', 'DEACTIVATED', 'ALL'])
    .optional(),
  region: z.string().trim().optional(),
  schemaVersion: z.string().trim().optional(),
  migrationStatus: z.enum(['UP_TO_DATE', 'PENDING', 'MIGRATING', 'FAILED', 'ALL']).optional(),
  healthStatus: z.enum(['HEALTHY', 'UNHEALTHY', 'UNKNOWN', 'ALL']).optional(),
});
export type ListTenantDatabasesQueryDto = z.infer<typeof listTenantDatabasesQueryDto>;

export const executeTenantDatabaseOperationDto = z.object({
  action: z.enum([
    'PROVISION',
    'RETRY_PROVISIONING',
    'MIGRATE',
    'HEALTH_CHECK',
    'BACKUP',
    'RESTORE',
    'ROLLBACK',
  ]),
  targetVersion: z.string().trim().max(50).optional(),
  maintenanceWindow: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(500),
  backupConfirmed: z.boolean().default(false).optional(),
  poolLimit: z.coerce.number().int().min(1).max(50).optional(),
  customDatabaseName: z.string().trim().max(63).optional(),
  connectionUrl: z.string().trim().url().optional(),
});
export type ExecuteTenantDatabaseOperationDto = z.infer<
  typeof executeTenantDatabaseOperationDto
>;
