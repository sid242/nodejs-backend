import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  appModules,
  permissions,
  rolePermissions,
  roles,
  tenantMemberRoles,
  tenantMembers,
  tenantModules,
  userGroupMembers,
  userGroupRoles,
  userGroups,
  type AppModule,
  type NewAppModule,
  type NewPermission,
  type NewRoleRecord,
  type Permission,
  type RoleRecord,
} from '@/db/schema/index';

import type { DomainModuleDefinition } from './modules.types';

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
      const parts = perm.key.split(':');
      const resource = perm.resource ?? parts[0] ?? 'general';
      const action = perm.action ?? parts[1] ?? 'manage';
      const code = perm.code ?? perm.key;
      const scope = perm.scope ?? 'TENANT';
      const riskLevel = perm.riskLevel ?? 'LOW';
      const isSystem = perm.isSystem ?? true;
      const isAssignable = perm.isAssignable ?? true;

      await db
        .insert(permissions)
        .values({
          moduleId: moduleRecord.id,
          key: perm.key,
          code,
          name: perm.name,
          description: perm.description,
          action,
          resource,
          scope,
          riskLevel,
          isSystem,
          isAssignable,
        })
        .onConflictDoUpdate({
          target: permissions.key,
          set: {
            moduleId: moduleRecord.id,
            code,
            name: perm.name,
            description: perm.description,
            action,
            resource,
            scope,
            riskLevel,
            isSystem,
            isAssignable,
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

export async function findRoleByCode(code: string, tenantId?: string | null): Promise<RoleRecord | null> {
  const conditions = [eq(roles.code, code)];
  if (tenantId) {
    conditions.push(or(eq(roles.tenantId, tenantId), isNull(roles.tenantId))!);
  } else {
    conditions.push(isNull(roles.tenantId));
  }
  const [record] = await db
    .select()
    .from(roles)
    .where(and(...conditions))
    .limit(1);
  return record ?? null;
}

export async function createRole(data: NewRoleRecord): Promise<RoleRecord> {
  const [record] = await db.insert(roles).values(data).returning();
  return record!;
}

export async function updateRole(
  id: string,
  data: { name?: string; description?: string; isActive?: boolean },
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

export async function assignRoleToMember(memberId: string, roleId: string, tenantId?: string): Promise<void> {
  let resolvedTenantId = tenantId;
  if (!resolvedTenantId) {
    const [member] = await db.select({ tenantId: tenantMembers.tenantId }).from(tenantMembers).where(eq(tenantMembers.id, memberId)).limit(1);
    resolvedTenantId = member?.tenantId;
  }
  await db.insert(tenantMemberRoles).values({ memberId, roleId, tenantId: resolvedTenantId }).onConflictDoNothing();
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
      code: roles.code,
      name: roles.name,
      description: roles.description,
      scope: roles.scope,
      isActive: roles.isActive,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(tenantMemberRoles)
    .innerJoin(roles, eq(tenantMemberRoles.roleId, roles.id))
    .where(and(eq(tenantMemberRoles.memberId, memberId), eq(roles.isActive, true)));
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
 * Counts how many groups currently hold a specific role.
 */
export async function countGroupsAssignedToRole(roleId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userGroupRoles)
    .where(eq(userGroupRoles.roleId, roleId));
  return result?.count ?? 0;
}

export interface RoleWithCountsAndPermissions extends RoleRecord {
  assignedUsersCount: number;
  assignedGroupsCount: number;
  permissions: string[];
}

export interface ListRolesResult {
  items: RoleWithCountsAndPermissions[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listRolesWithFilters(
  tenantId: string | null,
  filters: {
    search?: string;
    scope?: string;
    status?: string;
    isSystem?: string;
    module?: string;
    permission?: string;
    page?: number;
    limit?: number;
    sortBy?: 'name' | 'code' | 'createdAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
  },
): Promise<ListRolesResult> {
  const page = Math.max(1, filters?.page ?? 1);
  const limit = Math.max(1, Math.min(100, filters?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions: any[] = [];

  // Tenant scoping: for tenant callers, include their tenant's roles and global system roles
  if (tenantId) {
    conditions.push(or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)));
  } else {
    // Platform / global callers
    if (filters?.scope === 'TENANT') {
      conditions.push(isNotNull(roles.tenantId));
    } else if (filters?.scope === 'PLATFORM') {
      conditions.push(isNull(roles.tenantId));
    }
  }

  if (filters?.scope && filters.scope !== 'ALL') {
    conditions.push(eq(roles.scope, filters.scope));
  }

  if (filters?.status === 'ACTIVE') {
    conditions.push(eq(roles.isActive, true));
  } else if (filters?.status === 'ARCHIVED') {
    conditions.push(eq(roles.isActive, false));
  }

  if (filters?.isSystem === 'true') {
    conditions.push(eq(roles.isSystem, true));
  } else if (filters?.isSystem === 'false') {
    conditions.push(eq(roles.isSystem, false));
  }

  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(roles.name, q),
        ilike(roles.code, q),
        ilike(roles.description, q),
      ),
    );
  }

  if (filters?.module && filters.module.trim()) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM "RolePermission" rp
        INNER JOIN "Permission" p ON rp."permissionId" = p."id"
        INNER JOIN "AppModule" m ON p."moduleId" = m."id"
        WHERE rp."roleId" = "AppRole"."id" AND m."key" = ${filters.module.trim()}
      )`,
    );
  }

  if (filters?.permission && filters.permission.trim()) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM "RolePermission" rp
        INNER JOIN "Permission" p ON rp."permissionId" = p."id"
        WHERE rp."roleId" = "AppRole"."id" AND (p."key" = ${filters.permission.trim()} OR p."code" = ${filters.permission.trim()})
      )`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count query
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roles)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Sorting
  const sortCol =
    filters?.sortBy === 'name'
      ? roles.name
      : filters?.sortBy === 'code'
        ? roles.code
        : filters?.sortBy === 'updatedAt'
          ? roles.updatedAt
          : roles.createdAt;
  const orderFn = filters?.sortOrder === 'asc' ? asc : desc;

  // Select roles with counts
  const rolesRows = await db
    .select({
      id: roles.id,
      tenantId: roles.tenantId,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      scope: roles.scope,
      isActive: roles.isActive,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
      assignedUsersCount: sql<number>`(SELECT count(*)::int FROM "TenantMemberRole" WHERE "TenantMemberRole"."roleId" = "AppRole"."id")`,
      assignedGroupsCount: sql<number>`(SELECT count(*)::int FROM "UserGroupRole" WHERE "UserGroupRole"."roleId" = "AppRole"."id")`,
    })
    .from(roles)
    .where(whereClause)
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(offset);

  // Fetch permissions for returned roles
  const roleIds = rolesRows.map((r) => r.id);
  const permsByRole = new Map<string, string[]>();
  if (roleIds.length > 0) {
    const rolePermRows = await db
      .select({
        roleId: rolePermissions.roleId,
        permissionKey: permissions.key,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds));

    for (const row of rolePermRows) {
      const list = permsByRole.get(row.roleId) ?? [];
      list.push(row.permissionKey);
      permsByRole.set(row.roleId, list);
    }
  }

  const items: RoleWithCountsAndPermissions[] = rolesRows.map((r) => ({
    ...r,
    assignedUsersCount: Number(r.assignedUsersCount ?? 0),
    assignedGroupsCount: Number(r.assignedGroupsCount ?? 0),
    permissions: permsByRole.get(r.id) ?? [],
  }));

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
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

export interface EffectivePermissionsResult {
  roles: string[];
  permissions: string[];
  provenance?: {
    directRoles: string[];
    groupRoles: string[];
  };
}

/**
 * Resolves all distinct permissions for a user within a specific tenant across all their assigned active roles
 * (both directly assigned roles and inherited through active user groups).
 */
export async function getEffectivePermissions(
  tenantId: string,
  userId: string,
): Promise<EffectivePermissionsResult> {
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
    return { roles: [], permissions: [], provenance: { directRoles: [], groupRoles: [] } };
  }

  // 1. Direct active member roles
  const directRoles = await getMemberRoles(member.id);

  // 2. Active roles inherited through active tenant user groups
  const groupRoles = await db
    .select({
      id: roles.id,
      tenantId: roles.tenantId,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      scope: roles.scope,
      isActive: roles.isActive,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(userGroupMembers)
    .innerJoin(userGroups, eq(userGroupMembers.groupId, userGroups.id))
    .innerJoin(userGroupRoles, eq(userGroupMembers.groupId, userGroupRoles.groupId))
    .innerJoin(roles, eq(userGroupRoles.roleId, roles.id))
    .where(
      and(
        eq(userGroupMembers.userId, userId),
        eq(userGroupMembers.tenantId, tenantId),
        eq(userGroups.status, 'ACTIVE'),
        eq(roles.isActive, true),
      ),
    );

  const directRoleNames = directRoles.map((r) => r.name);
  const groupRoleNames = groupRoles.map((r) => r.name);

  // Combine unique active roles
  const combinedMap = new Map<string, RoleRecord>();
  for (const r of directRoles) combinedMap.set(r.id, r);
  for (const r of groupRoles) combinedMap.set(r.id, r);

  const allAssignedRoles = Array.from(combinedMap.values());
  if (allAssignedRoles.length === 0) {
    return {
      roles: [],
      permissions: [],
      provenance: { directRoles: directRoleNames, groupRoles: groupRoleNames },
    };
  }

  const roleIds = allAssignedRoles.map((r) => r.id);
  const roleNames = Array.from(new Set(allAssignedRoles.map((r) => r.name)));

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
    provenance: {
      directRoles: directRoleNames,
      groupRoles: groupRoleNames,
    },
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

export async function findDisabledTenantModules(tenantId: string): Promise<Array<{ id: string; key: string }>> {
  return db
    .select({ id: appModules.id, key: appModules.key })
    .from(tenantModules)
    .innerJoin(appModules, eq(tenantModules.moduleId, appModules.id))
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.isEnabled, false)));
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
  findRoleByCode,
  findRolesByTenant,
  listRolesWithFilters,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissionKeys,
  setRolePermissions,
  assignRoleToMember,
  removeRoleFromMember,
  getMemberRoles,
  countMembersAssignedToRole,
  countGroupsAssignedToRole,
  countTenantOwners,
  getEffectivePermissions,
  setTenantModuleEnabled,
  getTenantModules,
  syncSystemModules,
};
