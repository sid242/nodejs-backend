import { z } from 'zod';

// ==========================================
// Platform Staff DTOs
// ==========================================

export const listStaffQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  roleId: z.string().uuid().optional(),
});
export type ListStaffQueryDto = z.infer<typeof listStaffQueryDto>;

export const createStaffDto = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(100),
  roleId: z.string().uuid(),
});
export type CreateStaffDto = z.infer<typeof createStaffDto>;

export const loginStaffDto = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginStaffDto = z.infer<typeof loginStaffDto>;

export const updateStaffDto = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
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
  reason: z.string().trim().min(5).max(500),
  durationMinutes: z.coerce.number().int().min(5).max(120).default(30),
  targetUserId: z.string().uuid().optional(),
});
export type StartSupportSessionDto = z.infer<typeof startSupportSessionDto>;

export const endSupportSessionDto = z.object({
  outcome: z.string().trim().max(500).optional(),
});
export type EndSupportSessionDto = z.infer<typeof endSupportSessionDto>;

export const listSupportSessionsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIALING', 'DEACTIVATED']).optional(),
  plan: z.string().trim().optional(),
  databaseMode: z.enum(['shared', 'dedicated']).optional(),
});
export type ListPlatformTenantsQueryDto = z.infer<typeof listPlatformTenantsQueryDto>;

export const provisionTenantDto = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must consist of lowercase alphanumeric characters and hyphens'),
  ownerEmail: z.string().trim().email(),
  plan: z.string().trim().default('FREE'),
  country: z.string().trim().max(100).optional(),
  timezone: z.string().trim().default('UTC'),
  databaseMode: z.enum(['shared', 'dedicated']).default('shared'),
  notes: z.string().trim().max(500).optional(),
});
export type ProvisionTenantDto = z.infer<typeof provisionTenantDto>;

export const updatePlatformTenantDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  plan: z.string().trim().optional(),
  databaseMode: z.enum(['shared', 'dedicated']).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type UpdatePlatformTenantDto = z.infer<typeof updatePlatformTenantDto>;

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
