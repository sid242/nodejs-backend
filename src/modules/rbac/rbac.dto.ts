import { z } from 'zod';

export const createRoleDto = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(255).optional(),
  permissions: z.array(z.string().min(1)).min(1, 'Role must have at least one permission'),
});

export type CreateRoleDto = z.infer<typeof createRoleDto>;

export const updateRoleDto = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  description: z.string().trim().max(255).optional(),
  permissions: z.array(z.string().min(1)).min(1).optional(),
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
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  action: z.string().trim().min(1).max(50).default('manage'),
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
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  action: z.string().trim().min(1).max(50).default('manage'),
});

export type CreatePermissionDto = z.input<typeof createPermissionDto>;

export const updatePermissionDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(255).optional(),
  action: z.string().trim().min(1).max(50).optional(),
});

export type UpdatePermissionDto = z.infer<typeof updatePermissionDto>;
