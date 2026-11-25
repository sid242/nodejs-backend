import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import {
  groupPolicies,
  permissions,
  platformPermissions,
  platformRolePermissions,
  platformRolePolicies,
  platformRoles,
  platformStaff,
  policies,
  rolePermissions,
  rolePolicies,
  roles,
  tenantMembers,
  userGroupMembers,
  userGroupPlatformRoles,
  userGroupRoles,
  userGroups,
  type NewUserGroup,
  type NewUserGroupMember,
  type Policy,
  type RoleRecord,
  type UserGroup,
  type UserGroupMember,
} from '@/db/schema';
import { assertTenantScope, primaryDbHandle, tenantDb } from '@/db/tenancy/context';
import { attachUsers } from '@/lib/attach-users';

function resolveGroupExecutor(
  scope?: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): DbExecutor {
  if (executor) return executor;
  if (scope === 'TENANT' || tenantId) {
    if (tenantId) assertTenantScope(tenantId);
    return tenantDb();
  }
  return primaryDbHandle();
}

export interface GroupListFilters {
  scope: 'PLATFORM' | 'TENANT';
  tenantId?: string;
  search?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
  roleId?: string;
  page: number;
  limit: number;
  sortBy?: 'createdAt' | 'name' | 'updatedAt' | 'slug';
  sortOrder?: 'asc' | 'desc';
}

export interface GroupWithMemberCount extends UserGroup {
  memberCount: number;
}

export async function createGroup(data: NewUserGroup, executor?: DbExecutor): Promise<UserGroup> {
  const exec = resolveGroupExecutor(data.scope, data.tenantId ?? undefined, executor);
  const [record] = await exec.insert(userGroups).values(data).returning();
  return record!;
}

export async function findGroupById(
  id: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): Promise<UserGroup | null> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const conditions = [eq(userGroups.id, id), eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await exec
    .select()
    .from(userGroups)
    .where(and(...conditions))
    .limit(1);

  return record ?? null;
}

export async function findGroupBySlug(
  slug: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): Promise<UserGroup | null> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const conditions = [
    eq(userGroups.slug, slug.toLowerCase()),
    eq(userGroups.scope, scope),
    isNull(userGroups.archivedAt),
  ];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await exec
    .select()
    .from(userGroups)
    .where(and(...conditions))
    .limit(1);

  return record ?? null;
}

export async function listGroups(
  filters: GroupListFilters,
  executor?: DbExecutor,
): Promise<{ items: GroupWithMemberCount[]; total: number; page: number; limit: number }> {
  const {
    scope,
    tenantId,
    search,
    status = 'ACTIVE',
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const conditions = [eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) {
      return { items: [], total: 0, page, limit };
    }
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  if (status !== 'ALL') {
    conditions.push(eq(userGroups.status, status));
  }

  if (filters.roleId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM "UserGroupRole" ugr
        WHERE ugr."groupId" = "UserGroup"."id" AND ugr."roleId" = ${filters.roleId}
      )`,
    );
  }

  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(userGroups.name, term),
        ilike(userGroups.slug, term),
        ilike(userGroups.description, term),
      )!,
    );
  }

  const whereClause = and(...conditions);

  // Total count
  const countRows = await exec.select({ totalCount: count() }).from(userGroups).where(whereClause);
  const total = Number(countRows?.[0]?.totalCount ?? 0);
  if (total === 0) {
    return { items: [], total: 0, page, limit };
  }

  const offset = (page - 1) * limit;
  const orderColumn =
    sortBy === 'name'
      ? userGroups.name
      : sortBy === 'slug'
        ? userGroups.slug
        : sortBy === 'updatedAt'
          ? userGroups.updatedAt
          : userGroups.createdAt;
  const direction = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn);

  // Group list with member count subquery
  const memberCountSubquery = sql<number>`(
    SELECT count(*)::int 
    FROM "UserGroupMember" 
    WHERE "UserGroupMember"."groupId" = "UserGroup"."id"
  )`;

  const rows = await exec
    .select({
      id: userGroups.id,
      name: userGroups.name,
      slug: userGroups.slug,
      description: userGroups.description,
      scope: userGroups.scope,
      tenantId: userGroups.tenantId,
      status: userGroups.status,
      createdBy: userGroups.createdBy,
      updatedBy: userGroups.updatedBy,
      archivedAt: userGroups.archivedAt,
      createdAt: userGroups.createdAt,
      updatedAt: userGroups.updatedAt,
      memberCount: memberCountSubquery,
    })
    .from(userGroups)
    .where(whereClause)
    .orderBy(direction)
    .limit(limit)
    .offset(offset);

  return {
    items: rows,
    total,
    page,
    limit,
  };
}

export async function updateGroup(
  id: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId: string | undefined,
  data: Partial<NewUserGroup>,
  executor?: DbExecutor,
): Promise<UserGroup | null> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const conditions = [eq(userGroups.id, id), eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await exec
    .update(userGroups)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  return record ?? null;
}

export async function archiveGroup(
  id: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): Promise<UserGroup | null> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const conditions = [eq(userGroups.id, id), eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await exec
    .update(userGroups)
    .set({
      status: 'ARCHIVED',
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  return record ?? null;
}

export async function addGroupMembers(
  members: NewUserGroupMember[],
  executor?: DbExecutor,
): Promise<UserGroupMember[]> {
  if (members.length === 0) return [];
  const exec = resolveGroupExecutor(
    members[0]?.tenantId ? 'TENANT' : 'PLATFORM',
    members[0]?.tenantId ?? undefined,
    executor,
  );
  return exec.insert(userGroupMembers).values(members).returning();
}

export async function removeGroupMember(
  groupId: string,
  memberId: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const group = await findGroupById(groupId, scope, tenantId, exec);
  if (!group) return false;

  const conditions = [eq(userGroupMembers.groupId, groupId)];

  if (scope === 'TENANT') {
    conditions.push(eq(userGroupMembers.userId, memberId));
    if (tenantId) {
      conditions.push(eq(userGroupMembers.tenantId, tenantId));
    }
  } else {
    conditions.push(eq(userGroupMembers.staffId, memberId));
  }

  const deleted = await exec
    .delete(userGroupMembers)
    .where(and(...conditions))
    .returning({ id: userGroupMembers.id });

  return deleted.length > 0;
}

export async function findExistingMemberIds(
  groupId: string,
  ids: string[],
  scope: 'PLATFORM' | 'TENANT',
  executor?: DbExecutor,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const exec = resolveGroupExecutor(scope, undefined, executor);

  if (scope === 'TENANT') {
    const rows = await exec
      .select({ userId: userGroupMembers.userId })
      .from(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, ids)));

    return rows.map((r) => r.userId!).filter(Boolean);
  } else {
    const rows = await exec
      .select({ staffId: userGroupMembers.staffId })
      .from(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.staffId, ids)));

    return rows.map((r) => r.staffId!).filter(Boolean);
  }
}

export async function listTenantGroupMembers(
  groupId: string,
  tenantId: string,
  page = 1,
  limit = 20,
  executor?: DbExecutor,
): Promise<{
  items: Array<{
    id: string;
    userId: string;
    name: string;
    email: string;
    status: string;
    joinedGroupAt: Date;
  }>;
  total: number;
  page: number;
  limit: number;
}> {
  assertTenantScope(tenantId);
  const exec = executor ?? tenantDb();
  const whereClause = and(
    eq(userGroupMembers.groupId, groupId),
    eq(userGroupMembers.tenantId, tenantId),
  );

  const countRows = await exec
    .select({ totalCount: count() })
    .from(userGroupMembers)
    .where(whereClause);
  const total = Number(countRows?.[0]?.totalCount ?? 0);
  if (total === 0) {
    return { items: [], total: 0, page, limit };
  }

  const offset = (page - 1) * limit;

  const rows = await exec
    .select({
      id: userGroupMembers.id,
      userId: userGroupMembers.userId,
      joinedGroupAt: userGroupMembers.createdAt,
    })
    .from(userGroupMembers)
    .where(whereClause)
    .orderBy(desc(userGroupMembers.createdAt))
    .limit(limit)
    .offset(offset);

  // Cross-DB safe user enrichment
  const enriched = await attachUsers(rows, 'userId', 'user');

  return {
    items: enriched.map((r) => ({
      id: r.id,
      userId: r.userId!,
      name: r.user?.name ?? '',
      email: r.user?.email ?? '',
      status: r.user?.status ?? 'INACTIVE',
      joinedGroupAt: r.joinedGroupAt,
    })),
    total,
    page,
    limit,
  };
}

export async function listPlatformGroupMembers(
  groupId: string,
  page = 1,
  limit = 20,
  executor?: DbExecutor,
): Promise<{
  items: Array<{
    id: string;
    staffId: string;
    displayName: string;
    email: string;
    status: string;
    roleId: string;
    joinedGroupAt: Date;
  }>;
  total: number;
  page: number;
  limit: number;
}> {
  const exec = executor ?? primaryDbHandle();
  const whereClause = eq(userGroupMembers.groupId, groupId);

  const countRows = await exec
    .select({ totalCount: count() })
    .from(userGroupMembers)
    .where(whereClause);
  const total = Number(countRows?.[0]?.totalCount ?? 0);
  if (total === 0) {
    return { items: [], total: 0, page, limit };
  }

  const offset = (page - 1) * limit;

  const rows = await exec
    .select({
      id: userGroupMembers.id,
      staffId: platformStaff.id,
      displayName: platformStaff.displayName,
      email: platformStaff.email,
      status: platformStaff.status,
      roleId: platformStaff.roleId,
      joinedGroupAt: userGroupMembers.createdAt,
    })
    .from(userGroupMembers)
    .innerJoin(platformStaff, eq(userGroupMembers.staffId, platformStaff.id))
    .where(whereClause)
    .orderBy(desc(userGroupMembers.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: rows,
    total,
    page,
    limit,
  };
}

export async function validateActiveTenantMembers(
  tenantId: string,
  userIds: string[],
  executor?: DbExecutor,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  assertTenantScope(tenantId);
  const exec = executor ?? tenantDb();

  const rows = await exec
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        inArray(tenantMembers.userId, userIds),
        eq(tenantMembers.status, 'ACTIVE'),
      ),
    );

  return rows.map((r) => r.userId);
}

export async function validateActivePlatformStaff(
  staffIds: string[],
  executor?: DbExecutor,
): Promise<string[]> {
  if (staffIds.length === 0) return [];
  const exec = executor ?? primaryDbHandle();

  const rows = await exec
    .select({ id: platformStaff.id })
    .from(platformStaff)
    .where(and(inArray(platformStaff.id, staffIds), eq(platformStaff.status, 'ACTIVE')));

  return rows.map((r) => r.id);
}

export async function bindRoleToGroup(
  groupId: string,
  roleId: string,
  executor?: DbExecutor,
): Promise<void> {
  const exec = executor ?? tenantDb();
  await exec.insert(userGroupRoles).values({ groupId, roleId }).onConflictDoNothing();
}

export async function unbindRoleFromGroup(
  groupId: string,
  roleId: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const exec = executor ?? tenantDb();
  const deleted = await exec
    .delete(userGroupRoles)
    .where(and(eq(userGroupRoles.groupId, groupId), eq(userGroupRoles.roleId, roleId)))
    .returning();
  return deleted.length > 0;
}

export async function listGroupRoles(
  groupId: string,
  executor?: DbExecutor,
): Promise<Array<RoleRecord & { permissions: string[] }>> {
  const exec = executor ?? tenantDb();
  const groupRoles = await exec
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
    .from(userGroupRoles)
    .innerJoin(roles, eq(userGroupRoles.roleId, roles.id))
    .where(eq(userGroupRoles.groupId, groupId));

  const roleIds = groupRoles.map((r) => r.id);
  const permsByRole = new Map<string, string[]>();
  if (roleIds.length > 0) {
    const permRows = await exec
      .select({
        roleId: rolePermissions.roleId,
        permissionKey: permissions.key,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds));

    for (const row of permRows) {
      const list = permsByRole.get(row.roleId) ?? [];
      list.push(row.permissionKey);
      permsByRole.set(row.roleId, list);
    }
  }

  return groupRoles.map((r) => ({
    ...r,
    permissions: permsByRole.get(r.id) ?? [],
  }));
}

export async function getGroupContributedPermissions(
  groupId: string,
  executor?: DbExecutor,
): Promise<string[]> {
  const exec = executor ?? tenantDb();
  const perms = await exec
    .selectDistinct({ key: permissions.key })
    .from(userGroupRoles)
    .innerJoin(roles, eq(userGroupRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(userGroupRoles.groupId, groupId), eq(roles.isActive, true)));

  return perms.map((p) => p.key);
}

export async function findGroupMemberUserIds(
  groupId: string,
  executor?: DbExecutor,
): Promise<string[]> {
  const exec = executor ?? tenantDb();
  const rows = await exec
    .select({ userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, groupId), isNotNull(userGroupMembers.userId)));
  return rows.map((r) => r.userId!).filter(Boolean);
}

export async function bindPlatformRoleToGroup(
  groupId: string,
  roleId: string,
  executor?: DbExecutor,
): Promise<void> {
  const exec = executor ?? primaryDbHandle();
  await exec.insert(userGroupPlatformRoles).values({ groupId, roleId }).onConflictDoNothing();
}

export async function unbindPlatformRoleFromGroup(
  groupId: string,
  roleId: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const exec = executor ?? primaryDbHandle();
  const deleted = await exec
    .delete(userGroupPlatformRoles)
    .where(
      and(eq(userGroupPlatformRoles.groupId, groupId), eq(userGroupPlatformRoles.roleId, roleId)),
    )
    .returning();
  return deleted.length > 0;
}

export async function listPlatformGroupRoles(
  groupId: string,
  executor?: DbExecutor,
): Promise<
  Array<{
    id: string;
    tenantId: null;
    code: string;
    key: string;
    name: string;
    description: string | null;
    scope: 'PLATFORM';
    isActive: boolean;
    isSystem: boolean;
    createdAt: Date;
    updatedAt: Date;
    permissions: string[];
  }>
> {
  const exec = executor ?? primaryDbHandle();
  const groupRoles = await exec
    .select({
      id: platformRoles.id,
      key: platformRoles.key,
      name: platformRoles.name,
      description: platformRoles.description,
      isActive: platformRoles.isActive,
      isSystem: platformRoles.isSystem,
      createdAt: platformRoles.createdAt,
      updatedAt: platformRoles.updatedAt,
    })
    .from(userGroupPlatformRoles)
    .innerJoin(platformRoles, eq(userGroupPlatformRoles.roleId, platformRoles.id))
    .where(eq(userGroupPlatformRoles.groupId, groupId));

  const roleIds = groupRoles.map((r) => r.id);
  const permsByRole = new Map<string, string[]>();
  if (roleIds.length > 0) {
    const permRows = await exec
      .select({
        roleId: platformRolePermissions.roleId,
        permissionKey: platformPermissions.key,
      })
      .from(platformRolePermissions)
      .innerJoin(
        platformPermissions,
        eq(platformRolePermissions.permissionId, platformPermissions.id),
      )
      .where(inArray(platformRolePermissions.roleId, roleIds));

    for (const row of permRows) {
      const list = permsByRole.get(row.roleId) ?? [];
      list.push(row.permissionKey);
      permsByRole.set(row.roleId, list);
    }
  }

  return groupRoles.map((r) => ({
    ...r,
    tenantId: null,
    code: r.key,
    scope: 'PLATFORM' as const,
    permissions: permsByRole.get(r.id) ?? [],
  }));
}

export async function getPlatformGroupContributedPermissions(
  groupId: string,
  executor?: DbExecutor,
): Promise<string[]> {
  const exec = executor ?? primaryDbHandle();
  const perms = await exec
    .selectDistinct({ key: platformPermissions.key })
    .from(userGroupPlatformRoles)
    .innerJoin(platformRoles, eq(userGroupPlatformRoles.roleId, platformRoles.id))
    .innerJoin(platformRolePermissions, eq(platformRoles.id, platformRolePermissions.roleId))
    .innerJoin(
      platformPermissions,
      eq(platformRolePermissions.permissionId, platformPermissions.id),
    )
    .where(and(eq(userGroupPlatformRoles.groupId, groupId), eq(platformRoles.isActive, true)));

  return perms.map((p) => p.key);
}

export async function bindPolicyToGroup(
  groupId: string,
  policyId: string,
  tenantId?: string,
  executor?: DbExecutor,
): Promise<void> {
  const exec = resolveGroupExecutor(tenantId ? 'TENANT' : 'PLATFORM', tenantId, executor);
  await exec
    .insert(groupPolicies)
    .values({ groupId, policyId, tenantId: tenantId ?? null })
    .onConflictDoNothing();
}

export async function unbindPolicyFromGroup(
  groupId: string,
  policyId: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);
  const conditions = [eq(groupPolicies.groupId, groupId), eq(groupPolicies.policyId, policyId)];
  if (scope === 'TENANT' && tenantId) {
    conditions.push(eq(groupPolicies.tenantId, tenantId));
  } else if (scope === 'PLATFORM') {
    conditions.push(isNull(groupPolicies.tenantId));
  }

  const deleted = await exec
    .delete(groupPolicies)
    .where(and(...conditions))
    .returning();
  return deleted.length > 0;
}

export async function listGroupPolicies(
  groupId: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor?: DbExecutor,
): Promise<{
  directPolicies: Policy[];
  inheritedRolePolicies: Array<{
    policy: Policy;
    roleId: string;
    roleName: string;
    roleCode: string | null;
  }>;
}> {
  const exec = resolveGroupExecutor(scope, tenantId, executor);

  const directWhere =
    scope === 'TENANT' && tenantId
      ? and(eq(groupPolicies.groupId, groupId), eq(groupPolicies.tenantId, tenantId))
      : and(eq(groupPolicies.groupId, groupId), isNull(groupPolicies.tenantId));

  const directRows = await exec
    .select({ policy: policies })
    .from(groupPolicies)
    .innerJoin(policies, eq(groupPolicies.policyId, policies.id))
    .where(directWhere)
    .orderBy(desc(policies.priority), desc(policies.createdAt));

  if (scope === 'TENANT' && tenantId) {
    const inheritedRows = await exec
      .select({
        policy: policies,
        roleId: roles.id,
        roleName: roles.name,
        roleCode: roles.code,
      })
      .from(userGroupRoles)
      .innerJoin(roles, eq(userGroupRoles.roleId, roles.id))
      .innerJoin(rolePolicies, eq(roles.id, rolePolicies.roleId))
      .innerJoin(policies, eq(rolePolicies.policyId, policies.id))
      .where(and(eq(userGroupRoles.groupId, groupId), eq(rolePolicies.tenantId, tenantId)))
      .orderBy(desc(policies.priority), desc(policies.createdAt));

    return {
      directPolicies: directRows.map((r) => r.policy),
      inheritedRolePolicies: inheritedRows,
    };
  }

  const inheritedPlatformRows = await exec
    .select({
      policy: policies,
      roleId: platformRoles.id,
      roleName: platformRoles.name,
      roleCode: platformRoles.key,
    })
    .from(userGroupPlatformRoles)
    .innerJoin(platformRoles, eq(userGroupPlatformRoles.roleId, platformRoles.id))
    .innerJoin(platformRolePolicies, eq(platformRoles.id, platformRolePolicies.roleId))
    .innerJoin(policies, eq(platformRolePolicies.policyId, policies.id))
    .where(eq(userGroupPlatformRoles.groupId, groupId))
    .orderBy(desc(policies.priority), desc(policies.createdAt));

  return {
    directPolicies: directRows.map((r) => r.policy),
    inheritedRolePolicies: inheritedPlatformRows,
  };
}

export const groupsRepo = {
  createGroup,
  findGroupById,
  findGroupBySlug,
  listGroups,
  updateGroup,
  archiveGroup,
  addGroupMembers,
  removeGroupMember,
  findExistingMemberIds,
  listTenantGroupMembers,
  listPlatformGroupMembers,
  validateActiveTenantMembers,
  validateActivePlatformStaff,
  bindRoleToGroup,
  unbindRoleFromGroup,
  listGroupRoles,
  getGroupContributedPermissions,
  findGroupMemberUserIds,
  bindPlatformRoleToGroup,
  unbindPlatformRoleFromGroup,
  listPlatformGroupRoles,
  getPlatformGroupContributedPermissions,
  bindPolicyToGroup,
  unbindPolicyFromGroup,
  listGroupPolicies,
};
