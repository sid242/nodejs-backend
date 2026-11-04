import { aliasedTable, and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  auditLogs,
  tenantAuditPolicies,
  users,
  type AuditLog,
  type NewAuditLog,
  type TenantAuditPolicy,
} from '@/db/schema/index';

const actorUsers = aliasedTable(users, 'actor_user');
const effectiveUsers = aliasedTable(users, 'effective_user');

export interface EnrichedAuditLog extends AuditLog {
  actorName?: string | null;
  actorEmail?: string | null;
  effectiveUserName?: string | null;
  effectiveUserEmail?: string | null;
}

export interface AuditLogFilters {
  tenantId?: string;
  userId?: string;
  actorUserId?: string;
  effectiveUserId?: string;
  action?: string;
  actions?: string[];
  search?: string;
  entityType?: string;
  resourceType?: string;
  resourceId?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'DENIED' | string;
  source?: 'DIRECT' | 'GROUP' | 'IMPERSONATION' | 'SYSTEM' | 'JOB' | string;
  requestId?: string;
  correlationId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
  page?: number;
}

/**
 * Append-only ingestion: Creates a new audit log record.
 * Normal application APIs never expose update or delete methods on auditLogs.
 */
export async function createAuditLog(data: NewAuditLog): Promise<AuditLog> {
  const [record] = await db.insert(auditLogs).values(data).returning();
  return record!;
}

export async function findAuditLogs(filters: AuditLogFilters): Promise<{
  items: EnrichedAuditLog[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = (page - 1) * limit;

  const conditions = buildConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rawItems, totalResult] = await Promise.all([
    db
      .select({
        log: auditLogs,
        actorName: actorUsers.name,
        actorEmail: actorUsers.email,
        effectiveUserName: effectiveUsers.name,
        effectiveUserEmail: effectiveUsers.email,
      })
      .from(auditLogs)
      .leftJoin(actorUsers, eq(auditLogs.actorUserId, actorUsers.id))
      .leftJoin(effectiveUsers, eq(auditLogs.effectiveUserId, effectiveUsers.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(whereClause),
  ]);

  const items: EnrichedAuditLog[] = rawItems.map((r) => ({
    ...r.log,
    actorName: r?.actorName ?? null,
    actorEmail: r?.actorEmail ?? null,
    effectiveUserName: r?.effectiveUserName ?? null,
    effectiveUserEmail: r?.effectiveUserEmail ?? null,
  }));

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  };
}

export async function findAuditLogsForExport(
  filters: AuditLogFilters,
  maxLimit = 5000,
): Promise<EnrichedAuditLog[]> {
  const conditions = buildConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rawItems = await db
    .select({
      log: auditLogs,
      actorName: actorUsers.name,
      actorEmail: actorUsers.email,
      effectiveUserName: effectiveUsers.name,
      effectiveUserEmail: effectiveUsers.email,
    })
    .from(auditLogs)
    .leftJoin(actorUsers, eq(auditLogs.actorUserId, actorUsers.id))
    .leftJoin(effectiveUsers, eq(auditLogs.effectiveUserId, effectiveUsers.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(maxLimit);

  return rawItems.map((r) => ({
    ...r.log,
    actorName: r?.actorName ?? null,
    actorEmail: r?.actorEmail ?? null,
    effectiveUserName: r?.effectiveUserName ?? null,
    effectiveUserEmail: r?.effectiveUserEmail ?? null,
  }));
}

function buildConditions(filters: AuditLogFilters) {
  const conditions = [];

  if (filters?.tenantId) conditions.push(eq(auditLogs.tenantId, filters.tenantId));
  if (filters?.userId) {
    conditions.push(
      or(
        eq(auditLogs.userId, filters.userId),
        eq(auditLogs.actorUserId, filters.userId),
        eq(auditLogs.effectiveUserId, filters.userId),
      ),
    );
  }
  if (filters?.actorUserId) conditions.push(eq(auditLogs.actorUserId, filters.actorUserId));
  if (filters?.effectiveUserId)
    conditions.push(eq(auditLogs.effectiveUserId, filters.effectiveUserId));
  if (filters?.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters?.actions && filters.actions.length > 0)
    conditions.push(inArray(auditLogs.action, filters.actions));
  if (filters?.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters?.resourceType)
    conditions.push(
      or(
        eq(auditLogs.resourceType, filters.resourceType),
        eq(auditLogs.entityType, filters.resourceType),
      ),
    );
  if (filters?.resourceId)
    conditions.push(
      or(
        eq(auditLogs.resourceId, filters.resourceId),
        eq(auditLogs.entityId, filters.resourceId),
      ),
    );
  if (filters?.result) conditions.push(eq(auditLogs.result, filters.result));
  if (filters?.source) conditions.push(eq(auditLogs.source, filters.source));
  if (filters?.requestId) conditions.push(eq(auditLogs.requestId, filters.requestId));
  if (filters?.correlationId) conditions.push(eq(auditLogs.correlationId, filters.correlationId));
  if (filters?.startDate) conditions.push(gte(auditLogs.createdAt, new Date(filters.startDate)));
  if (filters?.endDate) conditions.push(lte(auditLogs.createdAt, new Date(filters.endDate)));

  if (filters?.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(auditLogs.action, term),
        ilike(auditLogs.ipAddress, term),
        ilike(auditLogs.entityType, term),
        ilike(auditLogs.entityId, term),
        ilike(auditLogs.resourceType, term),
        ilike(auditLogs.resourceId, term),
        ilike(auditLogs.reason, term),
        ilike(auditLogs.requestId, term),
      ),
    );
  }

  return conditions;
}

// ---------------------------------------------------------------------------
// Retention Policies & Maintenance
// ---------------------------------------------------------------------------

export async function findTenantAuditPolicy(tenantId: string): Promise<TenantAuditPolicy | null> {
  const [record] = await db
    .select()
    .from(tenantAuditPolicies)
    .where(eq(tenantAuditPolicies.tenantId, tenantId))
    .limit(1);
  return record ?? null;
}

export async function upsertTenantAuditPolicy(
  tenantId: string,
  data: {
    retentionDays: number;
    exportAllowed?: boolean;
    complianceFramework?: string;
    updatedBy?: string | null;
  },
): Promise<TenantAuditPolicy> {
  const [record] = await db
    .insert(tenantAuditPolicies)
    .values({
      tenantId,
      retentionDays: data.retentionDays,
      exportAllowed: data?.exportAllowed ?? true,
      complianceFramework: data?.complianceFramework ?? 'SOC2',
      updatedBy: data?.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [tenantAuditPolicies.tenantId],
      set: {
        retentionDays: data.retentionDays,
        ...(data.exportAllowed !== undefined && { exportAllowed: data.exportAllowed }),
        ...(data.complianceFramework !== undefined && {
          complianceFramework: data.complianceFramework,
        }),
        ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
        updatedAt: new Date(),
      },
    })
    .returning();

  return record!;
}

/**
 * Retention worker: Purges logs that exceed the configured retention window.
 * Internal maintenance only.
 */
export async function purgeLogsOlderThan(
  tenantId: string,
  retentionDays: number,
): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), lt(auditLogs.createdAt, cutoff)))
    .returning({ id: auditLogs.id });

  // Update policy lastArchivedAt
  await db
    .update(tenantAuditPolicies)
    .set({ lastArchivedAt: new Date() })
    .where(eq(tenantAuditPolicies.tenantId, tenantId));

  return { deletedCount: result?.length ?? 0 };
}
