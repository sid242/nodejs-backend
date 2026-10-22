import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/config/db.js';
import { roles } from '@/db/schema/index.js';
import { cache } from '@/lib/cache.js';
import { AppError } from '@/lib/errors.js';

import { SYSTEM_MODULE_DEFINITIONS } from './modules.registry.js';
import * as dto from './rbac.dto.js';
import {
  rbacRepo,
  type AppModule,
  type ModuleWithPermissions,
  type Permission,
} from './rbac.repository.js';

export const SYSTEM_PERMISSIONS = SYSTEM_MODULE_DEFINITIONS.flatMap((m) =>
  m.permissions.map((p) => ({
    key: p.key,
    name: p.name,
    action: p.action,
    description: p.description,
    category: m.name,
  })),
);

export const SYSTEM_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
};

const rbacCacheKey = (tenantId: string, userId: string) => `rbac:perms:${tenantId}:${userId}`;

/**
 * Initializes default system modules, permissions, and roles from the registry.
 */
export async function seedDefaultRbac(): Promise<void> {
  // 1. Synchronize all decentralized domain modules and their permissions into PostgreSQL
  await rbacRepo.syncSystemModules(SYSTEM_MODULE_DEFINITIONS);

  // 2. Ensure global system roles exist (tenantId is null)
  const allPerms = await rbacRepo.findAllPermissions();
  const permsMap = new Map(allPerms.map((p) => [p.key, p.id]));

  const systemRolesToEnsure = [
    {
      name: SYSTEM_ROLES.OWNER,
      description: 'Full control over the tenant, its members, and resources',
      permissions: allPerms.map((p) => p.key),
    },
    {
      name: SYSTEM_ROLES.ADMIN,
      description: 'Administrative access except destructive tenant operations',
      permissions: allPerms.map((p) => p.key).filter((k) => k !== 'tenants:delete'),
    },
    {
      name: SYSTEM_ROLES.MEMBER,
      description: 'Standard member with read/write access to files and view access to tenant',
      permissions: ['tenants:read', 'members:read', 'files:read', 'files:write'],
    },
    {
      name: SYSTEM_ROLES.VIEWER,
      description: 'Read-only access to tenant files and info',
      permissions: ['tenants:read', 'members:read', 'files:read'],
    },
  ];

  for (const roleDef of systemRolesToEnsure) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.name, roleDef.name), isNull(roles.tenantId)))
      .limit(1);

    let roleId = existing?.id;
    if (!roleId) {
      const created = await rbacRepo.createRole({
        name: roleDef.name,
        description: roleDef.description,
        isSystem: true,
        tenantId: null,
      });
      roleId = created.id;
    }

    // Attach permissions
    const permIds = roleDef.permissions
      .map((k) => permsMap.get(k))
      .filter((id): id is string => !!id);

    await rbacRepo.setRolePermissions(roleId, permIds);
  }
}

/**
 * High performance resolution of effective user permissions within a tenant, cached in Redis.
 */
export async function resolveUserPermissions(
  tenantId: string,
  userId: string,
): Promise<{ roles: string[]; permissions: string[] }> {
  return cache.wrap(rbacCacheKey(tenantId, userId), 300, async () => {
    return rbacRepo.getEffectivePermissions(tenantId, userId);
  });
}

/**
 * Invalidate cached permissions when roles or memberships change.
 */
export async function invalidateRbacCache(tenantId: string, userId?: string): Promise<void> {
  if (userId) {
    await cache.del(rbacCacheKey(tenantId, userId));
  } else {
    await cache.delByPrefix(`rbac:perms:${tenantId}:`);
  }
}

export async function createCustomTenantRole(
  tenantId: string,
  name: string,
  description: string | undefined,
  permissionKeys: string[],
): Promise<{ id: string; name: string; permissions: string[] }> {
  const allPerms = await rbacRepo.findAllPermissions();
  const permsMap = new Map(allPerms.map((p) => [p.key, p.id]));

  const unknownKeys = permissionKeys.filter((k) => !permsMap.has(k));
  if (unknownKeys.length > 0) {
    throw AppError.badRequest(`Unknown permission key(s): ${unknownKeys.join(', ')}`);
  }

  const role = await rbacRepo.createRole({
    tenantId,
    name,
    description,
    isSystem: false,
  });

  const permIds = permissionKeys.map((k) => permsMap.get(k)!);

  await rbacRepo.setRolePermissions(role.id, permIds);
  await invalidateRbacCache(tenantId);

  return { id: role.id, name: role.name, permissions: permissionKeys };
}

export async function updateCustomTenantRole(
  tenantId: string,
  roleId: string,
  data: dto.UpdateRoleDto,
): Promise<{ id: string; name: string; permissions: string[] }> {
  const role = await rbacRepo.findRoleById(roleId);
  if (!role) throw AppError.notFound('Role not found');
  if (role.isSystem) throw AppError.forbidden('Cannot modify built-in system roles');
  if (role.tenantId !== tenantId) throw AppError.forbidden('Role does not belong to this tenant');

  if (data.name || data.description !== undefined) {
    await rbacRepo.updateRole(roleId, {
      name: data.name,
      description: data.description,
    });
  }

  let finalPermissions: string[];
  if (data.permissions) {
    const allPerms = await rbacRepo.findAllPermissions();
    const permsMap = new Map(allPerms.map((p) => [p.key, p.id]));

    const unknownKeys = data.permissions.filter((k) => !permsMap.has(k));
    if (unknownKeys.length > 0) {
      throw AppError.badRequest(`Unknown permission key(s): ${unknownKeys.join(', ')}`);
    }

    const permIds = data.permissions.map((k) => permsMap.get(k)!);

    await rbacRepo.setRolePermissions(roleId, permIds);
    finalPermissions = data.permissions;
  } else {
    finalPermissions = await rbacRepo.getRolePermissionKeys(roleId);
  }

  await invalidateRbacCache(tenantId);

  return {
    id: role.id,
    name: data.name ?? role.name,
    permissions: finalPermissions,
  };
}

export async function deleteTenantRole(tenantId: string, roleId: string): Promise<void> {
  const role = await rbacRepo.findRoleById(roleId);
  if (!role) throw AppError.notFound('Role not found');
  if (role.isSystem) throw AppError.forbidden('Cannot delete built-in system roles');
  if (role.tenantId !== tenantId) throw AppError.forbidden('Role does not belong to this tenant');

  // Edge case safeguard: Cannot delete a role that still has active members assigned!
  const assignedCount = await rbacRepo.countMembersAssignedToRole(roleId);
  if (assignedCount > 0) {
    throw AppError.badRequest(
      `Cannot delete role "${role.name}" because it is currently assigned to ${assignedCount} member(s). Reassign them first.`,
    );
  }

  await rbacRepo.deleteRole(roleId);
  await invalidateRbacCache(tenantId);
}

export async function listModulesWithPermissions(): Promise<ModuleWithPermissions[]> {
  return rbacRepo.findAllModulesWithPermissions();
}

export async function getModuleById(moduleId: string): Promise<ModuleWithPermissions> {
  const module = await rbacRepo.findModuleById(moduleId);
  if (!module) throw AppError.notFound('Module not found');

  const perms = await rbacRepo.findPermissionsByModuleId(moduleId);
  return {
    ...module,
    permissions: perms,
  };
}

export async function createModule(data: dto.CreateModuleDto): Promise<ModuleWithPermissions> {
  const existing = await rbacRepo.findModuleByKey(data.key);
  if (existing) {
    throw AppError.conflict(`Module with key '${data.key}' already exists`);
  }

  if (data.permissions && data.permissions.length > 0) {
    for (const p of data.permissions) {
      const existingPerm = await rbacRepo.findPermissionByKey(p.key);
      if (existingPerm) {
        throw AppError.conflict(`Permission with key '${p.key}' already exists`);
      }
    }
  }

  const createdModule = await rbacRepo.createModule({
    key: data.key,
    name: data.name,
    description: data.description,
    icon: data.icon,
    sortOrder: data.sortOrder ?? 0,
    isSystem: false,
  });

  let createdPerms: any[] = [];
  if (data.permissions && data.permissions.length > 0) {
    createdPerms = await rbacRepo.createPermissionsBatch(
      data.permissions.map((p) => ({
        moduleId: createdModule.id,
        key: p.key,
        name: p.name,
        description: p.description,
        action: p.action ?? 'manage',
        category: data.name,
      })),
    );
  }

  await cache.delByPrefix('tenant:modules:');

  return {
    ...createdModule,
    permissions: createdPerms,
  };
}

export async function updateModule(
  moduleId: string,
  data: dto.UpdateModuleDto,
): Promise<AppModule> {
  const module = await rbacRepo.findModuleById(moduleId);
  if (!module) throw AppError.notFound('Module not found');

  const updated = await rbacRepo.updateModule(moduleId, data);
  if (!updated) throw AppError.notFound('Module not found');

  await cache.delByPrefix('tenant:modules:');
  return updated;
}

export async function deleteModule(moduleId: string): Promise<void> {
  const module = await rbacRepo.findModuleById(moduleId);
  if (!module) throw AppError.notFound('Module not found');
  if (module.isSystem) throw AppError.forbidden('Cannot delete built-in system modules');

  await rbacRepo.deleteModule(moduleId);

  await Promise.all([cache.delByPrefix('tenant:modules:'), cache.delByPrefix('rbac:perms:')]);
}

export async function createPermission(
  data: dto.CreatePermissionDto & { moduleId: string },
): Promise<Permission> {
  const module = await rbacRepo.findModuleById(data.moduleId);
  if (!module) throw AppError.notFound('Module not found');

  const existing = await rbacRepo.findPermissionByKey(data.key);
  if (existing) {
    throw AppError.conflict(`Permission with key '${data.key}' already exists`);
  }

  const created = await rbacRepo.createPermission({
    moduleId: data.moduleId,
    key: data.key,
    name: data.name,
    description: data.description,
    action: data.action ?? 'manage',
    category: module.name,
  });

  await cache.delByPrefix('rbac:perms:');
  return created;
}

export async function getPermissionById(permissionId: string): Promise<Permission> {
  const perm = await rbacRepo.findPermissionById(permissionId);
  if (!perm) throw AppError.notFound('Permission not found');
  return perm;
}

export async function updatePermission(
  permissionId: string,
  data: dto.UpdatePermissionDto,
): Promise<Permission> {
  const perm = await rbacRepo.findPermissionById(permissionId);
  if (!perm) throw AppError.notFound('Permission not found');

  const updated = await rbacRepo.updatePermission(permissionId, data);
  if (!updated) throw AppError.notFound('Permission not found');

  await cache.delByPrefix('rbac:perms:');
  return updated;
}

export async function deletePermission(permissionId: string): Promise<void> {
  const perm = await rbacRepo.findPermissionById(permissionId);
  if (!perm) throw AppError.notFound('Permission not found');

  const isSystemPerm = SYSTEM_PERMISSIONS.some((sp) => sp.key === perm.key);
  if (isSystemPerm) {
    throw AppError.forbidden('Cannot delete built-in system permissions');
  }

  await rbacRepo.deletePermission(permissionId);
  await cache.delByPrefix('rbac:perms:');
}

export async function listTenantModules(tenantId: string) {
  return cache.wrap(`tenant:modules:${tenantId}`, 300, async () => {
    return rbacRepo.getTenantModules(tenantId);
  });
}

export async function setTenantModuleStatus(
  tenantId: string,
  moduleId: string,
  isEnabled: boolean,
): Promise<{ message: string; isEnabled: boolean }> {
  await rbacRepo.setTenantModuleEnabled(tenantId, moduleId, isEnabled);
  await Promise.all([cache.del(`tenant:modules:${tenantId}`), invalidateRbacCache(tenantId)]);
  return {
    message: `Module ${isEnabled ? 'enabled' : 'disabled'} successfully for this tenant`,
    isEnabled,
  };
}
