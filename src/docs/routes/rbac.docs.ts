import { z } from 'zod';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  createRoleDto,
  updateRoleDto,
  createModuleDto,
  updateModuleDto,
  createPermissionDto,
  updatePermissionDto,
  toggleModuleDto,
} from '@/modules/rbac/rbac.dto.js';
import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers.js';

export const PermissionSchema = z.object({
  id: z.string().uuid(),
  moduleId: z.string().uuid(),
  key: z.string().openapi({ example: 'files:write' }),
  name: z.string().openapi({ example: 'Upload Files' }),
  description: z.string().nullable(),
  action: z.string().openapi({ example: 'write' }),
  category: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const ModuleSchema = z.object({
  id: z.string().uuid(),
  key: z.string().openapi({ example: 'files' }),
  name: z.string().openapi({ example: 'File Storage' }),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int().openapi({ example: 10 }),
  isSystem: z.boolean().openapi({ example: true }),
  permissions: z.array(PermissionSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const TenantModuleSchema = z.object({
  id: z.string().uuid(),
  key: z.string().openapi({ example: 'files' }),
  name: z.string().openapi({ example: 'File Storage' }),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int().openapi({ example: 10 }),
  isEnabled: z.boolean().openapi({ example: true }),
});

export const RoleWithPermissionsSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  name: z.string().openapi({ example: 'Custom Editor' }),
  description: z.string().nullable(),
  isSystem: z.boolean().openapi({ example: false }),
  permissions: z.array(z.string()).openapi({ example: ['files:read', 'files:write'] }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

export function registerRbacDocs(registry: OpenAPIRegistry): void {
  registry.register('Permission', PermissionSchema);
  registry.register('Module', ModuleSchema);
  registry.register('TenantModule', TenantModuleSchema);
  registry.register('RoleWithPermissions', RoleWithPermissionsSchema);

  const CreateRoleInput = registry.register('CreateRoleInput', createRoleDto);
  const UpdateRoleInput = registry.register('UpdateRoleInput', updateRoleDto);
  const CreateModuleInput = registry.register('CreateModuleInput', createModuleDto);
  const UpdateModuleInput = registry.register('UpdateModuleInput', updateModuleDto);
  const CreatePermissionInput = registry.register('CreatePermissionInput', createPermissionDto);
  const UpdatePermissionInput = registry.register('UpdatePermissionInput', updatePermissionDto);
  const ToggleModuleInput = registry.register('ToggleModuleInput', toggleModuleDto);

  // Modules Catalog & Management
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rbac/modules',
    summary: 'List modules with nested permissions tree',
    description: 'Retrieves all platform modules along with their configured permissions.',
    tags: ['RBAC - Modules'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(ModuleSchema), 'Modules catalog with permissions tree'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/rbac/modules/{moduleId}',
    summary: 'Get module details',
    description: 'Retrieves a single module and its permissions.',
    tags: ['RBAC - Modules'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(ModuleSchema, 'Module details'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Module not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/rbac/modules',
    summary: 'Create a new module (System Admin only)',
    description: 'Registers a new platform module and optionally provisions initial permissions.',
    tags: ['RBAC - Modules'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreateModuleInput } } },
    },
    responses: {
      201: successResponse(ModuleSchema, 'Module created successfully'),
      400: errorResponse('Invalid parameters'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      409: errorResponse('Module key already exists'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rbac/modules/{moduleId}',
    summary: 'Update module (System Admin only)',
    description: 'Updates module metadata like display name, description, icon, or sort order.',
    tags: ['RBAC - Modules'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: UpdateModuleInput } } },
    },
    responses: {
      200: successResponse(ModuleSchema, 'Module updated successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Module not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/rbac/modules/{moduleId}',
    summary: 'Delete custom module (System Admin only)',
    description: 'Deletes a custom module. Built-in system modules cannot be deleted.',
    tags: ['RBAC - Modules'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.object({ message: z.string() }), 'Module deleted successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Module not found'),
    },
  });

  // Permissions Catalog & Management
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rbac/permissions',
    summary: 'List all available system permissions',
    description: 'Catalog of granular permissions that can be assigned to custom roles.',
    tags: ['RBAC - Permissions'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(PermissionSchema), 'Available permissions catalog'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/rbac/permissions/{permissionId}',
    summary: 'Get permission details',
    tags: ['RBAC - Permissions'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(PermissionSchema, 'Permission details'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Permission not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/rbac/permissions',
    summary: 'Create permission under a module (System Admin only)',
    tags: ['RBAC - Permissions'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreatePermissionInput } } },
    },
    responses: {
      201: successResponse(PermissionSchema, 'Permission created successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      409: errorResponse('Permission key already exists'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rbac/permissions/{permissionId}',
    summary: 'Update permission (System Admin only)',
    tags: ['RBAC - Permissions'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: UpdatePermissionInput } } },
    },
    responses: {
      200: successResponse(PermissionSchema, 'Permission updated successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Permission not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/rbac/permissions/{permissionId}',
    summary: 'Delete permission (System Admin only)',
    tags: ['RBAC - Permissions'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.object({ message: z.string() }), 'Permission deleted successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Permission not found'),
    },
  });

  // Tenant-Scoped Dynamic Roles
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rbac/tenants/{tenantId}/roles',
    summary: 'List available roles for a tenant',
    description:
      'Returns both global system roles (OWNER, ADMIN, MEMBER, VIEWER) and custom tenant roles.',
    tags: ['RBAC - Tenant Roles'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(RoleWithPermissionsSchema), 'Tenant roles list'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/rbac/tenants/{tenantId}/roles',
    summary: 'Create custom tenant role',
    description: 'Creates a custom role and attaches granular permissions.',
    tags: ['RBAC - Tenant Roles'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreateRoleInput } } },
    },
    responses: {
      201: successResponse(RoleWithPermissionsSchema, 'Role created successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rbac/tenants/{tenantId}/roles/{roleId}',
    summary: 'Update custom tenant role',
    tags: ['RBAC - Tenant Roles'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: UpdateRoleInput } } },
    },
    responses: {
      200: successResponse(RoleWithPermissionsSchema, 'Role updated successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Role not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/rbac/tenants/{tenantId}/roles/{roleId}',
    summary: 'Delete custom tenant role',
    tags: ['RBAC - Tenant Roles'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.object({ message: z.string() }), 'Role deleted successfully'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Role not found'),
    },
  });

  // Tenant-Scoped Module Entitlements
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rbac/tenants/{tenantId}/modules',
    summary: 'List modules with tenant enablement status',
    tags: ['RBAC - Entitlements'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(z.array(TenantModuleSchema), 'Tenant modules list'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rbac/tenants/{tenantId}/modules/{moduleId}',
    summary: 'Enable or disable a module for a tenant (Feature Gating)',
    tags: ['RBAC - Entitlements'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: ToggleModuleInput } } },
    },
    responses: {
      200: successResponse(
        z.object({ message: z.string(), isEnabled: z.boolean() }),
        'Module entitlement toggled',
      ),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden'),
    },
  });
}
