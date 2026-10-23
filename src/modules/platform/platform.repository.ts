import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '@/config/db.js';
import {
  plans,
  platformAuditLogs,
  platformPermissions,
  platformRolePermissions,
  platformRoles,
  platformStaff,
  platformSupportSessions,
  publicPlatformStaff,
  subscriptions,
  tenantBrandings,
  tenants,
  type NewPlatformAuditLog,
  type NewPlatformRole,
  type NewPlatformStaff,
  type NewPlatformSupportSession,
  type NewSubscription,
  type NewTenant,
  type PlatformPermission,
  type PlatformRole,
  type PlatformStaff,
} from '@/db/schema/index.js';

import type {
  ListPlatformTenantsQueryDto,
  ListStaffQueryDto,
  QueryPlatformAuditLogsDto,
  UpdateStaffDto,
} from './platform.dto.js';

// ==========================================
// 1. Platform Staff Queries
// ==========================================

export async function findStaffByEmail(email: string): Promise<PlatformStaff | null> {
  const [staff] = await db
    .select()
    .from(platformStaff)
    .where(eq(platformStaff.email, email))
    .limit(1);
  return staff ?? null;
}

export async function findStaffById(id: string) {
  const [staff] = await db
    .select({
      id: platformStaff.id,
      email: platformStaff.email,
      displayName: platformStaff.displayName,
      status: platformStaff.status,
      roleId: platformStaff.roleId,
      roleKey: platformRoles.key,
      roleName: platformRoles.name,
      lastLoginAt: platformStaff.lastLoginAt,
      createdAt: platformStaff.createdAt,
      updatedAt: platformStaff.updatedAt,
    })
    .from(platformStaff)
    .leftJoin(platformRoles, eq(platformStaff.roleId, platformRoles.id))
    .where(eq(platformStaff.id, id))
    .limit(1);
  return staff ?? null;
}

export async function findStaffPaginated(filters: ListStaffQueryDto) {
  const conditions = [];
  if (filters?.status) conditions.push(eq(platformStaff.status, filters.status));
  if (filters?.roleId) conditions.push(eq(platformStaff.roleId, filters.roleId));

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: platformStaff.id,
        email: platformStaff.email,
        displayName: platformStaff.displayName,
        status: platformStaff.status,
        roleId: platformStaff.roleId,
        roleKey: platformRoles.key,
        roleName: platformRoles.name,
        lastLoginAt: platformStaff.lastLoginAt,
        createdAt: platformStaff.createdAt,
      })
      .from(platformStaff)
      .leftJoin(platformRoles, eq(platformStaff.roleId, platformRoles.id))
      .where(whereClause)
      .orderBy(desc(platformStaff.createdAt))
      .offset((filters.page - 1) * filters.limit)
      .limit(filters.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformStaff)
      .where(whereClause),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page: filters.page,
    limit: filters.limit,
  };
}

export async function createStaff(data: NewPlatformStaff) {
  const [created] = await db.insert(platformStaff).values(data).returning(publicPlatformStaff);
  if (!created) throw new Error('Failed to create platform staff record');
  return created;
}

export async function updateStaff(id: string, data: UpdateStaffDto) {
  const [updated] = await db
    .update(platformStaff)
    .set({
      ...(data.displayName ? { displayName: data.displayName } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.roleId ? { roleId: data.roleId } : {}),
    })
    .where(eq(platformStaff.id, id))
    .returning(publicPlatformStaff);
  return updated ?? null;
}

export async function updateStaffLastLogin(id: string) {
  await db.update(platformStaff).set({ lastLoginAt: new Date() }).where(eq(platformStaff.id, id));
}

// ==========================================
// 2. Platform Roles & Permissions Queries
// ==========================================

export async function listRoles() {
  const roles = await db.select().from(platformRoles).orderBy(desc(platformRoles.createdAt));

  const roleIds = roles.map((r) => r.id);
  if (!roleIds.length) return [];

  const rolePermRows = await db
    .select({
      roleId: platformRolePermissions.roleId,
      permissionKey: platformPermissions.key,
      permissionName: platformPermissions.name,
    })
    .from(platformRolePermissions)
    .innerJoin(
      platformPermissions,
      eq(platformRolePermissions.permissionId, platformPermissions.id),
    )
    .where(inArray(platformRolePermissions.roleId, roleIds));

  const permMap = new Map<string, string[]>();
  for (const row of rolePermRows) {
    if (!permMap.has(row.roleId)) {
      permMap.set(row.roleId, []);
    }
    permMap.get(row.roleId)!.push(row.permissionKey);
  }

  return roles.map((r) => ({
    ...r,
    permissions: permMap.get(r.id) ?? [],
  }));
}

export async function findRoleById(id: string) {
  const [role] = await db.select().from(platformRoles).where(eq(platformRoles.id, id)).limit(1);
  return role ?? null;
}

export async function findRoleByKey(key: string) {
  const [role] = await db.select().from(platformRoles).where(eq(platformRoles.key, key)).limit(1);
  return role ?? null;
}

export async function getRolePermissionKeys(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: platformPermissions.key })
    .from(platformRolePermissions)
    .innerJoin(
      platformPermissions,
      eq(platformRolePermissions.permissionId, platformPermissions.id),
    )
    .where(eq(platformRolePermissions.roleId, roleId));
  return rows.map((r) => r.key);
}

export async function listPermissions(): Promise<PlatformPermission[]> {
  return db
    .select()
    .from(platformPermissions)
    .orderBy(platformPermissions.resource, platformPermissions.action);
}

export async function findPermissionsByKeys(keys: string[]) {
  if (!keys.length) return [];
  return db.select().from(platformPermissions).where(inArray(platformPermissions.key, keys));
}

export async function createRole(data: NewPlatformRole, permissionIds: string[]) {
  return db.transaction(async (tx) => {
    const [role] = await tx.insert(platformRoles).values(data).returning();
    if (!role) throw new Error('Failed to create platform role record');
    if (permissionIds.length) {
      await tx.insert(platformRolePermissions).values(
        permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
      );
    }
    return role;
  });
}

export async function updateRole(
  id: string,
  data: Partial<PlatformRole>,
  permissionIds?: string[],
) {
  return db.transaction(async (tx) => {
    const [role] = await tx
      .update(platformRoles)
      .set(data)
      .where(eq(platformRoles.id, id))
      .returning();

    if (permissionIds !== undefined) {
      await tx.delete(platformRolePermissions).where(eq(platformRolePermissions.roleId, id));

      if (permissionIds.length) {
        await tx.insert(platformRolePermissions).values(
          permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        );
      }
    }
    return role;
  });
}

// ==========================================
// 3. Support Sessions
// ==========================================

export async function createSupportSession(data: NewPlatformSupportSession) {
  const [session] = await db.insert(platformSupportSessions).values(data).returning();
  if (!session) throw new Error('Failed to create support session record');
  return session;
}

export async function findSupportSessionById(id: string) {
  const [session] = await db
    .select()
    .from(platformSupportSessions)
    .where(eq(platformSupportSessions.id, id))
    .limit(1);
  return session ?? null;
}

export async function terminateSupportSession(id: string) {
  const [session] = await db
    .update(platformSupportSessions)
    .set({
      status: 'TERMINATED',
      endedAt: new Date(),
    })
    .where(eq(platformSupportSessions.id, id))
    .returning();
  return session ?? null;
}

export async function listSupportSessionsPaginated(filters?: { page?: number; limit?: number }) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: platformSupportSessions.id,
        staffId: platformSupportSessions.staffId,
        staffEmail: platformStaff.email,
        staffDisplayName: platformStaff.displayName,
        tenantId: platformSupportSessions.tenantId,
        reason: platformSupportSessions.reason,
        status: platformSupportSessions.status,
        expiresAt: platformSupportSessions.expiresAt,
        startedAt: platformSupportSessions.startedAt,
        endedAt: platformSupportSessions.endedAt,
      })
      .from(platformSupportSessions)
      .leftJoin(platformStaff, eq(platformSupportSessions.staffId, platformStaff.id))
      .orderBy(desc(platformSupportSessions.startedAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ count: sql<number>`count(*)::int` }).from(platformSupportSessions),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  };
}

// ==========================================
// 4. Platform Audit Trail
// ==========================================

export async function logPlatformAction(data: NewPlatformAuditLog) {
  try {
    const [log] = await db.insert(platformAuditLogs).values(data).returning();
    return log;
  } catch (err) {
    // Non-blocking fallback to protect business flow while preserving visibility
    console.error('Failed to write platform audit log:', err);
    return null;
  }
}

export async function queryPlatformAuditLogs(filters: QueryPlatformAuditLogsDto) {
  const conditions = [];
  if (filters?.actorStaffId)
    conditions.push(eq(platformAuditLogs.actorStaffId, filters.actorStaffId));
  if (filters?.action) conditions.push(eq(platformAuditLogs.action, filters.action));
  if (filters?.targetType) conditions.push(eq(platformAuditLogs.targetType, filters.targetType));
  if (filters?.targetId) conditions.push(eq(platformAuditLogs.targetId, filters.targetId));
  if (filters?.tenantId) conditions.push(eq(platformAuditLogs.tenantId, filters.tenantId));
  if (filters?.startDate)
    conditions.push(gte(platformAuditLogs.createdAt, new Date(filters.startDate)));
  if (filters?.endDate)
    conditions.push(lte(platformAuditLogs.createdAt, new Date(filters.endDate)));

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: platformAuditLogs.id,
        actorStaffId: platformAuditLogs.actorStaffId,
        staffDisplayName: platformStaff.displayName,
        staffEmail: platformStaff.email,
        action: platformAuditLogs.action,
        targetType: platformAuditLogs.targetType,
        targetId: platformAuditLogs.targetId,
        tenantId: platformAuditLogs.tenantId,
        metadata: platformAuditLogs.metadata,
        requestId: platformAuditLogs.requestId,
        ipAddress: platformAuditLogs.ipAddress,
        userAgent: platformAuditLogs.userAgent,
        createdAt: platformAuditLogs.createdAt,
      })
      .from(platformAuditLogs)
      .leftJoin(platformStaff, eq(platformAuditLogs.actorStaffId, platformStaff.id))
      .where(whereClause)
      .orderBy(desc(platformAuditLogs.createdAt))
      .offset((filters.page - 1) * filters.limit)
      .limit(filters.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(platformAuditLogs)
      .where(whereClause),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page: filters.page,
    limit: filters.limit,
  };
}

// ==========================================
// 5. Platform Tenant Lifecycle & Oversight Queries
// ==========================================

export async function findTenantsPaginated(filters: ListPlatformTenantsQueryDto) {
  const conditions = [isNull(tenants.deletedAt)];

  if (filters?.status) {
    conditions.push(eq(tenants.status, filters.status));
  }
  if (filters?.plan) {
    conditions.push(eq(tenants.plan, filters.plan));
  }
  if (filters?.databaseMode) {
    conditions.push(eq(tenants.databaseMode, filters.databaseMode));
  }
  if (filters?.search) {
    const searchPattern = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      or(ilike(tenants.name, searchPattern), ilike(tenants.slug, searchPattern))!,
    );
  }

  const whereClause = and(...conditions);

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        plan: tenants.plan,
        databaseMode: tenants.databaseMode,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        memberCount:
          sql<number>`(SELECT count(*)::int FROM "TenantMember" tm WHERE tm."tenantId" = "Tenant"."id" AND tm."status" IN ('ACTIVE', 'INVITED'))`.as(
            'memberCount',
          ),
        ownerEmail:
          sql<string | null>`(SELECT u."email" FROM "TenantMember" tm JOIN "User" u ON tm."userId" = u."id" JOIN "TenantMemberRole" tmr ON tmr."memberId" = tm."id" JOIN "AppRole" r ON tmr."roleId" = r."id" WHERE tm."tenantId" = "Tenant"."id" AND lower(r."name") = 'owner' LIMIT 1)`.as(
            'ownerEmail',
          ),
        ownerName:
          sql<string | null>`(SELECT u."name" FROM "TenantMember" tm JOIN "User" u ON tm."userId" = u."id" JOIN "TenantMemberRole" tmr ON tmr."memberId" = tm."id" JOIN "AppRole" r ON tmr."roleId" = r."id" WHERE tm."tenantId" = "Tenant"."id" AND lower(r."name") = 'owner' LIMIT 1)`.as(
            'ownerName',
          ),
        subscriptionId: subscriptions.id,
        subscriptionStatus: subscriptions.status,
        seatCount: subscriptions.seatCount,
        trialEndsAt: subscriptions.trialEndsAt,
      })
      .from(tenants)
      .leftJoin(subscriptions, eq(tenants.id, subscriptions.tenantId))
      .where(whereClause)
      .orderBy(desc(tenants.createdAt))
      .offset((filters.page - 1) * filters.limit)
      .limit(filters.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenants)
      .where(whereClause),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page: filters.page,
    limit: filters.limit,
  };
}

export async function findTenantDetailById(id: string) {
  const [tenant] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      plan: tenants.plan,
      databaseMode: tenants.databaseMode,
      schemaVersion: tenants.schemaVersion,
      metadata: tenants.metadata,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
      deletedAt: tenants.deletedAt,
      memberCount:
        sql<number>`(SELECT count(*)::int FROM "TenantMember" tm WHERE tm."tenantId" = "Tenant"."id" AND tm."status" IN ('ACTIVE', 'INVITED'))`.as(
          'memberCount',
        ),
      ownerEmail:
        sql<string | null>`(SELECT u."email" FROM "TenantMember" tm JOIN "User" u ON tm."userId" = u."id" JOIN "TenantMemberRole" tmr ON tmr."memberId" = tm."id" JOIN "AppRole" r ON tmr."roleId" = r."id" WHERE tm."tenantId" = "Tenant"."id" AND lower(r."name") = 'owner' LIMIT 1)`.as(
          'ownerEmail',
        ),
      ownerName:
        sql<string | null>`(SELECT u."name" FROM "TenantMember" tm JOIN "User" u ON tm."userId" = u."id" JOIN "TenantMemberRole" tmr ON tmr."memberId" = tm."id" JOIN "AppRole" r ON tmr."roleId" = r."id" WHERE tm."tenantId" = "Tenant"."id" AND lower(r."name") = 'owner' LIMIT 1)`.as(
          'ownerName',
        ),
    })
    .from(tenants)
    .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
    .limit(1);

  if (!tenant) return null;

  const [subscription, branding] = await Promise.all([
    db
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        planName: plans.name,
        planCode: plans.key,
        status: subscriptions.status,
        seatCount: subscriptions.seatCount,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
      })
      .from(subscriptions)
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.tenantId, id))
      .limit(1),
    db
      .select({
        companyName: tenantBrandings.companyName,
        logoUrl: tenantBrandings.logoUrl,
        primaryColor: tenantBrandings.primaryColor,
        accentColor: tenantBrandings.accentColor,
        customDomain: tenantBrandings.customDomain,
        customDomainStatus: tenantBrandings.customDomainStatus,
        supportEmail: tenantBrandings.supportEmail,
      })
      .from(tenantBrandings)
      .where(eq(tenantBrandings.tenantId, id))
      .limit(1),
  ]);

  return {
    ...tenant,
    subscription: subscription[0] ?? null,
    branding: branding[0] ?? null,
  };
}

export async function updateTenantPlatformFields(id: string, data: Partial<NewTenant>) {
  const [updated] = await db
    .update(tenants)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function findSubscriptionByTenantId(tenantId: string) {
  const [subscription] = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      planId: subscriptions.planId,
      status: subscriptions.status,
      seatCount: subscriptions.seatCount,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      trialEndsAt: subscriptions.trialEndsAt,
      planCode: plans.key,
      planName: plans.name,
    })
    .from(subscriptions)
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return subscription ?? null;
}

export async function updateTenantSubscription(
  tenantId: string,
  data: Partial<NewSubscription>,
) {
  const [updated] = await db
    .update(subscriptions)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.tenantId, tenantId))
    .returning();
  return updated ?? null;
}

