import { z } from 'zod';

export const listRolesFilterDto = z.object({
  search: z.string().trim().optional(),
  scope: z.enum(['TENANT', 'PLATFORM', 'ALL']).default('ALL'),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ALL'),
  isSystem: z.enum(['true', 'false', 'all']).default('all'),
  module: z.string().trim().optional(),
  permission: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'code', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListRolesFilterDto = z.infer<typeof listRolesFilterDto>;

export const createRoleDto = z.object({
  name: z.string().trim().min(2).max(50),
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Role code must be alphanumeric with underscores or dashes')
    .optional(),
  description: z.string().trim().max(255).optional(),
  scope: z.enum(['TENANT', 'PLATFORM']).default('TENANT').optional(),
  permissions: z.array(z.string().min(1)).min(1, 'Role must have at least one permission'),
  isActive: z.boolean().default(true).optional(),
});

export type CreateRoleDto = z.infer<typeof createRoleDto>;

export const updateRoleDto = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  description: z.string().trim().max(255).optional(),
  permissions: z.array(z.string().min(1)).min(1).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateRoleDto = z.infer<typeof updateRoleDto>;

export const assignRoleDto = z.object({
  roleId: z.string().uuid(),
});

export type AssignRoleDto = z.infer<typeof assignRoleDto>;

export const toggleModuleDto = z.object({
  isEnabled: z.boolean(),
});

export type ToggleModuleDto = z.infer<typeof toggleModuleDto>;

export const createPermissionInlineDto = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9_-]+:[a-z0-9_-]+$/,
      'Permission key must follow format "resource:action" (e.g. "billing:read")',
    ),
  code: z.string().trim().min(2).max(100).optional(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  scope: z.enum(['TENANT', 'PLATFORM']).default('TENANT').optional(),
  resource: z.string().trim().max(50).optional(),
  action: z.string().trim().min(1).max(50).default('manage'),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW').optional(),
  isAssignable: z.boolean().default(true).optional(),
});

export type CreatePermissionInlineDto = z.input<typeof createPermissionInlineDto>;

export const createModuleDto = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(
      /^[a-z0-9_-]+$/,
      'Module key must be lowercase alphanumeric with hyphens or underscores',
    ),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  icon: z.string().trim().max(50).optional(),
  sortOrder: z.number().int().optional().default(0),
  permissions: z.array(createPermissionInlineDto).optional(),
});

export type CreateModuleDto = z.input<typeof createModuleDto>;

export const updateModuleDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(255).optional(),
  icon: z.string().trim().max(50).optional(),
  sortOrder: z.number().int().optional(),
});

export type UpdateModuleDto = z.infer<typeof updateModuleDto>;

export const createPermissionDto = z.object({
  moduleId: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9_-]+:[a-z0-9_-]+$/,
      'Permission key must follow format "resource:action" (e.g. "billing:read")',
    ),
  code: z.string().trim().min(2).max(100).optional(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  scope: z.enum(['TENANT', 'PLATFORM']).default('TENANT').optional(),
  resource: z.string().trim().max(50).optional(),
  action: z.string().trim().min(1).max(50).default('manage'),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW').optional(),
  isAssignable: z.boolean().default(true).optional(),
});

export type CreatePermissionDto = z.input<typeof createPermissionDto>;

export const updatePermissionDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(255).optional(),
  action: z.string().trim().min(1).max(50).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  isAssignable: z.boolean().optional(),
});

export type UpdatePermissionDto = z.infer<typeof updatePermissionDto>;
