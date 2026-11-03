import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { db, type DbExecutor } from '@/config/db';
import {
  platformStaff,
  tenantMembers,
  userGroupMembers,
  userGroups,
  users,
  type NewUserGroup,
  type NewUserGroupMember,
  type UserGroup,
  type UserGroupMember,
} from '@/db/schema';

export interface GroupListFilters {
  scope: 'PLATFORM' | 'TENANT';
  tenantId?: string;
  search?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
  page: number;
  limit: number;
  sortBy?: 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface GroupWithMemberCount extends UserGroup {
  memberCount: number;
}

export async function createGroup(
  data: NewUserGroup,
  executor: DbExecutor = db,
): Promise<UserGroup> {
  const [record] = await executor.insert(userGroups).values(data).returning();
  return record!;
}

export async function findGroupById(
  id: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor: DbExecutor = db,
): Promise<UserGroup | null> {
  const conditions = [eq(userGroups.id, id), eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await executor
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
  executor: DbExecutor = db,
): Promise<UserGroup | null> {
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

  const [record] = await executor
    .select()
    .from(userGroups)
    .where(and(...conditions))
    .limit(1);

  return record ?? null;
}

export async function listGroups(
  filters: GroupListFilters,
  executor: DbExecutor = db,
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
  const countRows = await executor
    .select({ totalCount: count() })
    .from(userGroups)
    .where(whereClause);
  const total = Number(countRows?.[0]?.totalCount ?? 0);
  if (total === 0) {
    return { items: [], total: 0, page, limit };
  }

  const offset = (page - 1) * limit;
  const orderColumn = sortBy === 'name' ? userGroups.name : userGroups.createdAt;
  const direction = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn);

  // Group list with member count subquery
  const memberCountSubquery = sql<number>`(
    SELECT count(*)::int 
    FROM "UserGroupMember" 
    WHERE "UserGroupMember"."groupId" = "UserGroup"."id"
  )`;

  const rows = await executor
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
  executor: DbExecutor = db,
): Promise<UserGroup | null> {
  const conditions = [eq(userGroups.id, id), eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await executor
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
  executor: DbExecutor = db,
): Promise<UserGroup | null> {
  const conditions = [eq(userGroups.id, id), eq(userGroups.scope, scope)];

  if (scope === 'TENANT') {
    if (!tenantId) return null;
    conditions.push(eq(userGroups.tenantId, tenantId));
  } else {
    conditions.push(isNull(userGroups.tenantId));
  }

  const [record] = await executor
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
  executor: DbExecutor = db,
): Promise<UserGroupMember[]> {
  if (members.length === 0) return [];
  return executor.insert(userGroupMembers).values(members).returning();
}

export async function removeGroupMember(
  groupId: string,
  memberId: string,
  scope: 'PLATFORM' | 'TENANT',
  tenantId?: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const group = await findGroupById(groupId, scope, tenantId, executor);
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

  const deleted = await executor
    .delete(userGroupMembers)
    .where(and(...conditions))
    .returning({ id: userGroupMembers.id });

  return deleted.length > 0;
}

export async function findExistingMemberIds(
  groupId: string,
  ids: string[],
  scope: 'PLATFORM' | 'TENANT',
  executor: DbExecutor = db,
): Promise<string[]> {
  if (ids.length === 0) return [];

  if (scope === 'TENANT') {
    const rows = await executor
      .select({ userId: userGroupMembers.userId })
      .from(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, ids)));

    return rows.map((r) => r.userId!).filter(Boolean);
  } else {
    const rows = await executor
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
  executor: DbExecutor = db,
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
  const whereClause = and(
    eq(userGroupMembers.groupId, groupId),
    eq(userGroupMembers.tenantId, tenantId),
  );

  const countRows = await executor
    .select({ totalCount: count() })
    .from(userGroupMembers)
    .where(whereClause);
  const total = Number(countRows?.[0]?.totalCount ?? 0);
  if (total === 0) {
    return { items: [], total: 0, page, limit };
  }

  const offset = (page - 1) * limit;

  const rows = await executor
    .select({
      id: userGroupMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      joinedGroupAt: userGroupMembers.createdAt,
    })
    .from(userGroupMembers)
    .innerJoin(users, eq(userGroupMembers.userId, users.id))
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

export async function listPlatformGroupMembers(
  groupId: string,
  page = 1,
  limit = 20,
  executor: DbExecutor = db,
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
  const whereClause = eq(userGroupMembers.groupId, groupId);

  const countRows = await executor
    .select({ totalCount: count() })
    .from(userGroupMembers)
    .where(whereClause);
  const total = Number(countRows?.[0]?.totalCount ?? 0);
  if (total === 0) {
    return { items: [], total: 0, page, limit };
  }

  const offset = (page - 1) * limit;

  const rows = await executor
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
  executor: DbExecutor = db,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const rows = await executor
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
  executor: DbExecutor = db,
): Promise<string[]> {
  if (staffIds.length === 0) return [];

  const rows = await executor
    .select({ id: platformStaff.id })
    .from(platformStaff)
    .where(and(inArray(platformStaff.id, staffIds), eq(platformStaff.status, 'ACTIVE')));

  return rows.map((r) => r.id);
}
