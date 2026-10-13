import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/config/db.js';
import {
  appModules,
  permissions,
  roles,
  rolePermissions,
  tenantMemberRoles,
  tenantMembers,
  tenantModules,
  type AppModule,
  type NewAppModule,
  type Permission,
  type NewPermission,
  type RoleRecord,
  type NewRoleRecord,
} from '@/db/schema/index.js';
import type { DomainModuleDefinition } from './modules.types.js';

export type { AppModule, NewAppModule, Permission, NewPermission, RoleRecord, NewRoleRecord };

export interface ModuleWithPermissions extends AppModule {
  permissions: Permission[];
}

export async function findAllModulesWithPermissions(): Promise<ModuleWithPermissions[]> {
  const modulesList = await db.select().from(appModules).orderBy(asc(appModules.sortOrder));
  const permissionsList = await db.select().from(permissions).orderBy(asc(permissions.name));

  const permsByModule = new Map<string, Permission[]>();
  for (const perm of permissionsList) {
    const list = permsByModule.get(perm.moduleId) ?? [];
    list.push(perm);
    permsByModule.set(perm.moduleId, list);
  }

  return modulesList.map((m) => ({
    ...m,
    permissions: permsByModule.get(m.id) ?? [],
  }));
}

export async function findModuleById(id: string): Promise<AppModule | null> {
  const [record] = await db.select().from(appModules).where(eq(appModules.id, id)).limit(1);
  return record ?? null;
}

export async function findModuleByKey(key: string): Promise<AppModule | null> {
  const [record] = await db.select().from(appModules).where(eq(appModules.key, key)).limit(1);
  return record ?? null;
}

export async function createModule(data: NewAppModule): Promise<AppModule> {
  const [record] = await db.insert(appModules).values(data).returning();
  return record!;
}

export async function updateModule(
  id: string,
  data: Partial<NewAppModule>,
): Promise<AppModule | null> {
  const [record] = await db
    .update(appModules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(appModules.id, id))
    .returning();
  return record ?? null;
}

export async function deleteModule(id: string): Promise<boolean> {
  const [deleted] = await db.delete(appModules).where(eq(appModules.id, id)).returning();
  return !!deleted;
}

export async function syncSystemModules(definitions: DomainModuleDefinition[]): Promise<void> {
  for (const def of definitions) {
    // 1. Upsert AppModule
    const [moduleRecord] = await db
      .insert(appModules)
      .values({
        key: def.key,
        name: def.name,
        description: def.description,
        icon: def.icon,
        sortOrder: def.sortOrder ?? 0,
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: appModules.key,
        set: {
          name: def.name,
          description: def.description,
          icon: def.icon,
          sortOrder: def.sortOrder ?? 0,
        },
      })
      .returning();

    if (!moduleRecord) continue;

    // 2. Upsert permissions linked to this module
    for (const perm of def.permissions) {
      await db
        .insert(permissions)
        .values({
          moduleId: moduleRecord.id,
          key: perm.key,
          name: perm.name,
          description: perm.description,
          action: perm.action,
        })
        .onConflictDoUpdate({
          target: permissions.key,
          set: {
            moduleId: moduleRecord.id,
            name: perm.name,
            description: perm.description,
            action: perm.action,
          },
        });
    }
  }
}

export async function findAllPermissions(): Promise<Permission[]> {
  return db.select().from(permissions).orderBy(asc(permissions.name));
}

export async function findPermissionByKey(key: string): Promise<Permission | null> {
  const [record] = await db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
  return record ?? null;
}

export async function findPermissionById(id: string): Promise<Permission | null> {
  const [record] = await db.select().from(permissions).where(eq(permissions.id, id)).limit(1);
  return record ?? null;
}

export async function findPermissionsByModuleId(moduleId: string): Promise<Permission[]> {
  return db
    .select()
    .from(permissions)
    .where(eq(permissions.moduleId, moduleId))
    .orderBy(asc(permissions.name));
}

export async function createPermission(data: NewPermission): Promise<Permission> {
  const [record] = await db.insert(permissions).values(data).returning();
  return record!;
}

export async function createPermissionsBatch(data: NewPermission[]): Promise<Permission[]> {
  if (data.length === 0) return [];
  return db.insert(permissions).values(data).returning();
}

export async function updatePermission(
  id: string,
  data: Partial<NewPermission>,
): Promise<Permission | null> {
  const [record] = await db.update(permissions).set(data).where(eq(permissions.id, id)).returning();
  return record ?? null;
}

export async function deletePermission(id: string): Promise<boolean> {
  const [deleted] = await db.delete(permissions).where(eq(permissions.id, id)).returning();
  return !!deleted;
}

export async function findRolesByTenant(tenantId?: string | null): Promise<RoleRecord[]> {
  if (tenantId) {
    // Return both tenant-specific roles AND global system roles (where tenantId is null)
    return db
      .select()
      .from(roles)
      .where(or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)));
  }
  return db.select().from(roles).where(isNull(roles.tenantId));
}

export async function findRoleById(id: string): Promise<RoleRecord | null> {
  const [record] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return record ?? null;
}

export async function createRole(data: NewRoleRecord): Promise<RoleRecord> {
  const [record] = await db.insert(roles).values(data).returning();
  return record!;
}

export async function updateRole(
  id: string,
  data: { name?: string; description?: string },
): Promise<RoleRecord | null> {
  const [record] = await db
    .update(roles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning();
  return record ?? null;
}

export async function deleteRole(id: string): Promise<boolean> {
  const [deleted] = await db.delete(roles).where(eq(roles.id, id)).returning();
  return !!deleted;
}

export async function getRolePermissionKeys(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));

  return rows.map((r) => r.key);
}

export async function setRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissionIds.length > 0) {
      await tx.insert(rolePermissions).values(
        permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      );
    }
  });
}

export async function assignRoleToMember(memberId: string, roleId: string): Promise<void> {
  await db.insert(tenantMemberRoles).values({ memberId, roleId }).onConflictDoNothing();
}

export async function removeRoleFromMember(memberId: string, roleId: string): Promise<void> {
  await db
    .delete(tenantMemberRoles)
    .where(and(eq(tenantMemberRoles.memberId, memberId), eq(tenantMemberRoles.roleId, roleId)));
}

export async function getMemberRoles(memberId: string): Promise<RoleRecord[]> {
  return db
    .select({
      id: roles.id,
      tenantId: roles.tenantId,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(tenantMemberRoles)
    .innerJoin(roles, eq(tenantMemberRoles.roleId, roles.id))
    .where(eq(tenantMemberRoles.memberId, memberId));
}

/**
 * Counts how many members currently hold a specific role.
 * Used to block deleting roles that are still in active use.
 */
export async function countMembersAssignedToRole(roleId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMemberRoles)
    .where(eq(tenantMemberRoles.roleId, roleId));
  return result?.count ?? 0;
}

/**
 * Counts the number of active members in a tenant who hold the OWNER role.
 * Used to enforce the Last-Owner invariant and protect against tenant orphaning.
 */
export async function countTenantOwners(tenantId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(distinct ${tenantMembers.id})::int` })
    .from(tenantMembers)
    .innerJoin(tenantMemberRoles, eq(tenantMembers.id, tenantMemberRoles.memberId))
    .innerJoin(roles, eq(tenantMemberRoles.roleId, roles.id))
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.status, 'ACTIVE'),
        eq(roles.name, 'OWNER'),
      ),
    );
  return result?.count ?? 0;
}

/**
 * Resolves all distinct permissions for a user within a specific tenant across all their assigned roles.
 */
export async function getEffectivePermissions(
  tenantId: string,
  userId: string,
): Promise<{ roles: string[]; permissions: string[] }> {
  const [member] = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  if (!member) {
    return { roles: [], permissions: [] };
  }

  const assignedRoles = await getMemberRoles(member.id);
  if (assignedRoles.length === 0) {
    return { roles: [], permissions: [] };
  }

  const roleIds = assignedRoles.map((r) => r.id);
  const roleNames = assignedRoles.map((r) => r.name);

  // Filter out permissions belonging to modules that have been explicitly disabled for this tenant
  const disabledModules = await db
    .select({ moduleId: tenantModules.moduleId })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.isEnabled, false)));
  const disabledModuleIds = disabledModules.map((d) => d.moduleId);

  const whereClause =
    disabledModuleIds.length > 0
      ? and(
          inArray(rolePermissions.roleId, roleIds),
          notInArray(permissions.moduleId, disabledModuleIds),
        )
      : inArray(rolePermissions.roleId, roleIds);

  const perms = await db
    .selectDistinct({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(whereClause);

  return {
    roles: roleNames,
    permissions: perms.map((p) => p.key),
  };
}

export async function setTenantModuleEnabled(
  tenantId: string,
  moduleId: string,
  isEnabled: boolean,
): Promise<void> {
  await db
    .insert(tenantModules)
    .values({ tenantId, moduleId, isEnabled })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleId],
      set: { isEnabled },
    });
}

export async function getTenantModules(tenantId: string): Promise<
  Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    isEnabled: boolean;
  }>
> {
  const allModules = await db.select().from(appModules).orderBy(asc(appModules.sortOrder));
  const overrides = await db
    .select()
    .from(tenantModules)
    .where(eq(tenantModules.tenantId, tenantId));

  const overrideMap = new Map(overrides.map((o) => [o.moduleId, o.isEnabled]));

  return allModules.map((m) => ({
    id: m.id,
    key: m.key,
    name: m.name,
    description: m.description,
    icon: m.icon,
    sortOrder: m.sortOrder,
    isEnabled: overrideMap.has(m.id) ? overrideMap.get(m.id)! : true,
  }));
}

export const rbacRepo = {
  findAllModulesWithPermissions,
  findModuleById,
  findModuleByKey,
  createModule,
  updateModule,
  deleteModule,
  findPermissionsByModuleId,
  findPermissionById,
  findPermissionByKey,
  createPermission,
  createPermissionsBatch,
  updatePermission,
  deletePermission,
  findAllPermissions,
  findRoleById,
  findRolesByTenant,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissionKeys,
  setRolePermissions,
  assignRoleToMember,
  removeRoleFromMember,
  getMemberRoles,
  countMembersAssignedToRole,
  countTenantOwners,
  getEffectivePermissions,
  setTenantModuleEnabled,
  getTenantModules,
  syncSystemModules,
};
