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
