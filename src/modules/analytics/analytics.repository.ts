import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import * as schema from '@/db/schema';
import {
  activityFeed,
  auditLogs,
  emailMessages,
  files,
  platformMetricsDaily,
  reportDefinitions,
  reportRuns,
  tenants,
  usageDaily,
  usageEvents,
  users,
} from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';

// -----------------------------------------------------------------------------
// Usage Metering
// -----------------------------------------------------------------------------

export async function insertUsageEvent(data: {
  tenantId: string;
  meter: string;
  quantity: number;
  unit?: string;
  occurredAt?: Date;
  actorMemberId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  idempotencyKey?: string | null;
}) {
  const [created] = await tenantDb()
    .insert(usageEvents)
    .values({
      tenantId: data.tenantId,
      meter: data.meter,
      quantity: data.quantity,
      unit: data.unit ?? 'count',
      occurredAt: data.occurredAt ?? new Date(),
      actorMemberId: data.actorMemberId ?? null,
      resourceType: data.resourceType ?? null,
      resourceId: data.resourceId ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: usageEvents.idempotencyKey })
    .returning();

  return created ?? null;
}

export async function upsertUsageDaily(data: {
  tenantId: string;
  meter: string;
  date: string; // 'YYYY-MM-DD'
  quantity: number;
  unit?: string;
}) {
  const [row] = await tenantDb()
    .insert(usageDaily)
    .values({
      tenantId: data.tenantId,
      meter: data.meter,
      date: data.date,
      quantity: data.quantity,
      unit: data.unit ?? 'count',
    })
    .onConflictDoUpdate({
      target: [usageDaily.tenantId, usageDaily.meter, usageDaily.date],
      set: {
        quantity: sql`${usageDaily.quantity} + ${data.quantity}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

export async function getDailyUsageRollup(
  tenantId: string,
  from?: string,
  to?: string,
  meter?: string,
) {
  const conditions = [eq(usageDaily.tenantId, tenantId)];

  if (from) conditions.push(gte(usageDaily.date, from));
  if (to) conditions.push(lte(usageDaily.date, to));
  if (meter) conditions.push(eq(usageDaily.meter, meter));

  return tenantDb()
    .select()
    .from(usageDaily)
    .where(and(...conditions))
    .orderBy(desc(usageDaily.date));
}

// -----------------------------------------------------------------------------
// Activity Feed
// -----------------------------------------------------------------------------

export async function insertActivityFeedItem(data: {
  tenantId: string;
  actorId?: string | null;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  verb: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, any>;
}) {
  const [item] = await tenantDb()
    .insert(activityFeed)
    .values({
      tenantId: data.tenantId,
      actorId: data.actorId ?? null,
      actorName: data.actorName ?? null,
      actorAvatarUrl: data.actorAvatarUrl ?? null,
      verb: data.verb,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      summary: data.summary,
      metadata: data.metadata ?? {},
    })
    .returning();

  return item;
}

export async function getActivityFeed(
  tenantId: string,
  options?: { limit?: number; cursor?: string; entityType?: string },
) {
  const limit = options?.limit ?? 20;
  const conditions = [eq(activityFeed.tenantId, tenantId)];

  if (options?.entityType) {
    conditions.push(eq(activityFeed.entityType, options.entityType));
  }

  if (options?.cursor) {
    conditions.push(sql`${activityFeed.createdAt} < ${new Date(options.cursor)}`);
  }

  return tenantDb()
    .select()
    .from(activityFeed)
    .where(and(...conditions))
    .orderBy(desc(activityFeed.createdAt))
    .limit(limit);
}

// -----------------------------------------------------------------------------
// Report Definitions & Runs
// -----------------------------------------------------------------------------

export async function createReportDefinition(data: {
  tenantId: string;
  name: string;
  type: string;
  filters?: Record<string, any>;
  columns?: string[];
  format?: 'CSV' | 'JSON';
  schedule?: string | null;
  recipients?: string[];
  createdBy?: string | null;
}) {
  const [definition] = await tenantDb()
    .insert(reportDefinitions)
    .values({
      tenantId: data.tenantId,
      name: data.name,
      type: data.type,
      filters: data.filters ?? {},
      columns: data.columns ?? [],
      format: data.format ?? 'CSV',
      schedule: data.schedule ?? null,
      recipients: data.recipients ?? [],
      createdBy: data.createdBy ?? null,
    })
    .returning();

  return definition;
}

export async function listReportDefinitions(tenantId: string) {
  return tenantDb()
    .select()
    .from(reportDefinitions)
    .where(eq(reportDefinitions.tenantId, tenantId))
    .orderBy(desc(reportDefinitions.createdAt));
}

export async function getReportDefinitionById(id: string, tenantId: string) {
  const [def] = await tenantDb()
    .select()
    .from(reportDefinitions)
    .where(and(eq(reportDefinitions.id, id), eq(reportDefinitions.tenantId, tenantId)))
    .limit(1);

  return def ?? null;
}

export async function createReportRun(data: {
  tenantId: string;
  definitionId: string;
  status?: string;
}) {
  const [run] = await tenantDb()
    .insert(reportRuns)
    .values({
      tenantId: data.tenantId,
      definitionId: data.definitionId,
      status: data.status ?? 'PENDING',
      startedAt: new Date(),
    })
    .returning();

  return run;
}

export async function updateReportRun(
  id: string,
  tenantId: string,
  data: Partial<typeof reportRuns.$inferInsert>,
) {
  const [updated] = await tenantDb()
    .update(reportRuns)
    .set(data)
    .where(and(eq(reportRuns.id, id), eq(reportRuns.tenantId, tenantId)))
    .returning();

  return updated;
}

export async function listReportRuns(tenantId: string, definitionId?: string) {
  const conditions = [eq(reportRuns.tenantId, tenantId)];
  if (definitionId) conditions.push(eq(reportRuns.definitionId, definitionId));

  return tenantDb()
    .select()
    .from(reportRuns)
    .where(and(...conditions))
    .orderBy(desc(reportRuns.createdAt))
    .limit(50);
}

// -----------------------------------------------------------------------------
// Analytics Aggregates (DAU/WAU/MAU, Logins, Role Distribution, Security)
// -----------------------------------------------------------------------------

export async function getActiveMemberCounts(tenantId: string) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [dauRes] = await tenantDb()
    .select({ count: sql<number>`count(distinct ${schema.tenantMembers.id})::int` })
    .from(schema.tenantMembers)
    .where(
      and(
        eq(schema.tenantMembers.tenantId, tenantId),
        eq(schema.tenantMembers.status, 'ACTIVE'),
        gte(schema.tenantMembers.lastLoginAt, dayAgo),
      ),
    );

  const [wauRes] = await tenantDb()
    .select({ count: sql<number>`count(distinct ${schema.tenantMembers.id})::int` })
    .from(schema.tenantMembers)
    .where(
      and(
        eq(schema.tenantMembers.tenantId, tenantId),
        eq(schema.tenantMembers.status, 'ACTIVE'),
        gte(schema.tenantMembers.lastLoginAt, weekAgo),
      ),
    );

  const [mauRes] = await tenantDb()
    .select({ count: sql<number>`count(distinct ${schema.tenantMembers.id})::int` })
    .from(schema.tenantMembers)
    .where(
      and(
        eq(schema.tenantMembers.tenantId, tenantId),
        eq(schema.tenantMembers.status, 'ACTIVE'),
        gte(schema.tenantMembers.lastLoginAt, monthAgo),
      ),
    );

  const [totalRes] = await tenantDb()
    .select({ count: sql<number>`count(distinct ${schema.tenantMembers.id})::int` })
    .from(schema.tenantMembers)
    .where(
      and(eq(schema.tenantMembers.tenantId, tenantId), eq(schema.tenantMembers.status, 'ACTIVE')),
    );

  return {
    dau: Number(dauRes?.count ?? 0),
    wau: Number(wauRes?.count ?? 0),
    mau: Number(mauRes?.count ?? 0),
    totalActiveMembers: Number(totalRes?.count ?? 0),
  };
}

export async function getLoginsByDay(tenantId: string, daysAgo = 30) {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);

  const rows = await db
    .select({
      date: sql<string>`to_char(${schema.userLoginEvents.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.userLoginEvents)
    .where(
      and(
        eq(schema.userLoginEvents.tenantId, tenantId),
        gte(schema.userLoginEvents.createdAt, cutoff),
        eq(schema.userLoginEvents.result, 'SUCCESS'),
      ),
    )
    .groupBy(sql`to_char(${schema.userLoginEvents.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${schema.userLoginEvents.createdAt}, 'YYYY-MM-DD')`);

  return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
}

export async function getRoleDistribution(tenantId: string) {
  const rows = await tenantDb()
    .select({
      roleName: schema.roles.name,
      count: sql<number>`count(distinct ${schema.tenantMemberRoles.memberId})::int`,
    })
    .from(schema.roles)
    .leftJoin(schema.tenantMemberRoles, eq(schema.roles.id, schema.tenantMemberRoles.roleId))
    .where(eq(schema.roles.tenantId, tenantId))
    .groupBy(schema.roles.name);

  return rows.map((r) => ({ roleName: r.roleName, count: Number(r.count) }));
}

export async function getStorageStats(tenantId: string) {
  const [res] = await tenantDb()
    .select({
      totalBytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint`,
      fileCount: sql<number>`count(*)::int`,
    })
    .from(files)
    .where(and(eq(files.tenantId, tenantId), eq(files.status, 'UPLOADED')));

  // Top mime types
  const types = await tenantDb()
    .select({
      contentType: files.contentType,
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint`,
    })
    .from(files)
    .where(and(eq(files.tenantId, tenantId), eq(files.status, 'UPLOADED')))
    .groupBy(files.contentType)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  return {
    totalBytes: Number(res?.totalBytes ?? 0),
    fileCount: Number(res?.fileCount ?? 0),
    topFileTypes: types.map((t) => ({
      contentType: t.contentType,
      count: Number(t.count),
      bytes: Number(t.bytes),
    })),
  };
}

export async function getInviteStats(tenantId: string) {
  const [totalRes] = await tenantDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tenantInvitations)
    .where(eq(schema.tenantInvitations.tenantId, tenantId));

  const [acceptedRes] = await tenantDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tenantInvitations)
    .where(
      and(
        eq(schema.tenantInvitations.tenantId, tenantId),
        isNotNull(schema.tenantInvitations.acceptedAt),
      ),
    );

  const total = Number(totalRes?.count ?? 0);
  const accepted = Number(acceptedRes?.count ?? 0);
  const acceptanceRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

  return {
    totalInvitesSent: total,
    acceptedInvites: accepted,
    acceptanceRatePercent: acceptanceRate,
  };
}

export async function getSecurityPosture(tenantId: string) {
  // Total members
  const memberRows = await tenantDb()
    .select({
      memberId: schema.tenantMembers.id,
      userId: schema.tenantMembers.userId,
      twoFactorEnabled: isNotNull(users.twoFactorEnabledAt),
      lastLoginAt: schema.tenantMembers.lastLoginAt,
    })
    .from(schema.tenantMembers)
    .innerJoin(users, eq(schema.tenantMembers.userId, users.id))
    .where(
      and(eq(schema.tenantMembers.tenantId, tenantId), eq(schema.tenantMembers.status, 'ACTIVE')),
    );

  const total = memberRows.length;
  const mfaCount = memberRows.filter((m) => m.twoFactorEnabled).length;
  const mfaAdoptionPercent = total > 0 ? Math.round((mfaCount / total) * 100) : 0;

  // Stale accounts (no login in 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const staleCount = memberRows.filter(
    (m) => !m.lastLoginAt || new Date(m.lastLoginAt) < ninetyDaysAgo,
  ).length;

  // Check SSO config
  const [ssoConfig] = await tenantDb()
    .select({ id: schema.tenantSsoConfigs.id, status: schema.tenantSsoConfigs.status })
    .from(schema.tenantSsoConfigs)
    .where(eq(schema.tenantSsoConfigs.tenantId, tenantId))
    .limit(1);

  return {
    totalMembers: total,
    mfaEnabledMembers: mfaCount,
    mfaAdoptionPercent,
    staleAccountsCount: staleCount,
    ssoEnabled: ssoConfig?.status === 'ACTIVE',
  };
}

// -----------------------------------------------------------------------------
// Platform Executive Metrics
// -----------------------------------------------------------------------------

export async function getPlatformOverviewKPIs() {
  const [tenantCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(case when status = 'ACTIVE' then 1 end)::int`,
      suspended: sql<number>`count(case when status = 'SUSPENDED' then 1 end)::int`,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt));

  // Plan distribution
  const plansDist = await db
    .select({
      plan: tenants.plan,
      count: sql<number>`count(*)::int`,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .groupBy(tenants.plan);

  // Storage total across platform
  const [storageRes] = await db
    .select({
      totalStorageBytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint`,
      totalFiles: sql<number>`count(*)::int`,
    })
    .from(files)
    .where(eq(files.status, 'UPLOADED'));

  // Database mode distribution
  const dbDist = await db
    .select({
      databaseMode: tenants.databaseMode,
      count: sql<number>`count(*)::int`,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .groupBy(tenants.databaseMode);

  return {
    totalTenants: Number(tenantCounts?.total ?? 0),
    activeTenants: Number(tenantCounts?.active ?? 0),
    suspendedTenants: Number(tenantCounts?.suspended ?? 0),
    totalStorageBytes: Number(storageRes?.totalStorageBytes ?? 0),
    totalFiles: Number(storageRes?.totalFiles ?? 0),
    planDistribution: plansDist.map((p) => ({ plan: p.plan, count: Number(p.count) })),
    databaseModeDistribution: dbDist.map((d) => ({
      mode: d.databaseMode,
      count: Number(d.count),
    })),
  };
}

export async function listPlatformDailyMetrics(limitDays = 30) {
  return db
    .select()
    .from(platformMetricsDaily)
    .orderBy(desc(platformMetricsDaily.date))
    .limit(limitDays);
}
