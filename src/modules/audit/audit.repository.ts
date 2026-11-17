import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import { logger } from '@/config/logger';
import { assertTenantScope, primaryDbHandle, tenantDb } from '@/db/tenancy/context';
import {
  auditLogs,
  auditRetentionRuns,
  tenantAuditPolicies,
  users,
  type AuditLog,
  type NewAuditLog,
  type TenantAuditPolicy,
} from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { putObject } from '@/lib/s3';
import { computeAuditRowHash } from './audit.crypto';

function resolveAuditExecutor(tenantId?: string | null, executor?: DbExecutor): DbExecutor {
  if (executor) return executor;
  if (tenantId) {
    assertTenantScope(tenantId);
    return tenantDb();
  }
  return primaryDbHandle();
}

export interface EnrichedAuditLog extends AuditLog {
  actorName: string | null;
  actorEmail: string | null;
  effectiveUserName: string | null;
  effectiveUserEmail: string | null;
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
 * Enriches audit logs with user info from the primary database cluster without SQL joins.
 */
async function enrichAuditLogUsers(logs: AuditLog[]): Promise<EnrichedAuditLog[]> {
  if (!logs || logs.length === 0) return [];
  const userIds = new Set<string>();
  for (const log of logs) {
    if (log?.actorUserId) userIds.add(log.actorUserId);
    if (log?.effectiveUserId) userIds.add(log.effectiveUserId);
    if (log?.userId) userIds.add(log.userId);
  }
  const idArray = Array.from(userIds);
  if (idArray.length === 0) {
    return logs.map((log) => ({
      ...log,
      actorName: null,
      actorEmail: null,
      effectiveUserName: null,
      effectiveUserEmail: null,
    }));
  }

  const primaryDb = primaryDbHandle();
  const userRows = await primaryDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, idArray));

  const userMap = new Map(userRows.map((u) => [u.id, u]));

  return logs.map((log) => {
    const actor = log?.actorUserId ? userMap.get(log.actorUserId) : null;
    const effective = log?.effectiveUserId ? userMap.get(log.effectiveUserId) : null;
    return {
      ...log,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? null,
      effectiveUserName: effective?.name ?? null,
      effectiveUserEmail: effective?.email ?? null,
    };
  });
}

/**
 * Append-only ingestion: Creates a new audit log record.
 * Normal application APIs never expose update or delete methods on auditLogs.
 */
export async function createAuditLog(
  data: NewAuditLog,
  executor?: DbExecutor,
): Promise<AuditLog> {
  const exec = resolveAuditExecutor(data.tenantId, executor);

  let finalData = data;
  if (!data.rowHash) {
    let lastRow = null;
    try {
      if (data.tenantId) {
        const [latest] = await exec
          .select({ rowHash: auditLogs.rowHash })
          .from(auditLogs)
          .where(eq(auditLogs.tenantId, data.tenantId))
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(1);
        lastRow = latest;
      } else {
        const [latest] = await exec
          .select({ rowHash: auditLogs.rowHash })
          .from(auditLogs)
          .where(isNull(auditLogs.tenantId))
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(1);
        lastRow = latest;
      }
    } catch {
      /* fallback gracefully if table empty or query fails */
    }

    const prevHash = lastRow?.rowHash ?? null;
    const rowHash = computeAuditRowHash(prevHash, {
      tenantId: data.tenantId,
      action: data.action,
      actorUserId: data.actorUserId,
      actorEmail: data.actorEmail,
      actorType: data.actorType,
      source: data.source,
      result: data.result,
      entityType: data.entityType,
      entityId: data.entityId,
      createdAt: data.createdAt ?? new Date(),
    });

    finalData = { ...data, prevHash, rowHash };
  }

  const [record] = await exec.insert(auditLogs).values(finalData).returning();
  return record!;
}

export async function findAuditLogs(
  filters: AuditLogFilters,
  executor?: DbExecutor,
): Promise<{
  items: EnrichedAuditLog[];
  total: number;
  page: number;
  limit: number;
}> {
  const exec = resolveAuditExecutor(filters.tenantId, executor);
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = (page - 1) * limit;

  const conditions = buildConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rawLogs, totalResult] = await Promise.all([
    exec
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    exec
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(whereClause),
  ]);

  const items = await enrichAuditLogUsers(rawLogs);

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
  executor?: DbExecutor,
): Promise<EnrichedAuditLog[]> {
  const exec = resolveAuditExecutor(filters.tenantId, executor);
  const conditions = buildConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rawLogs = await exec
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(maxLimit);

  return enrichAuditLogUsers(rawLogs);
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

export async function findTenantAuditPolicy(
  tenantId: string,
  executor?: DbExecutor,
): Promise<TenantAuditPolicy | null> {
  const exec = resolveAuditExecutor(tenantId, executor);
  const [record] = await exec
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
  executor?: DbExecutor,
): Promise<TenantAuditPolicy> {
  const exec = resolveAuditExecutor(tenantId, executor);
  const [record] = await exec
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
  executor?: DbExecutor,
): Promise<{ deletedCount: number; s3Key?: string; archiveSha256?: string }> {
  const exec = resolveAuditExecutor(tenantId, executor);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // 1. Fetch expired rows for cold archive
  const expiredRows = await exec
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), lt(auditLogs.createdAt, cutoff)))
    .orderBy(asc(auditLogs.createdAt));

  let archiveS3Key: string | undefined;
  let archiveSha256: string | undefined;

  if (expiredRows.length > 0) {
    // 2. Format as NDJSON and compress with gzip
    const ndjson = expiredRows.map((r) => JSON.stringify(r)).join('\n');
    const gzipped = zlib.gzipSync(Buffer.from(ndjson, 'utf8'));
    archiveSha256 = crypto.createHash('sha256').update(gzipped).digest('hex');

    const year = cutoff.getUTCFullYear();
    const month = String(cutoff.getUTCMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    archiveS3Key = `audit-archive/${tenantId}/${year}/${month}/audit-archive-${timestamp}.ndjson.gz`;

    try {
      await putObject(archiveS3Key, gzipped, 'application/gzip', {
        'x-amz-meta-sha256': archiveSha256,
        'x-amz-meta-count': String(expiredRows.length),
        'x-amz-meta-tenant-id': tenantId,
      });
    } catch (err) {
      logger.error(
        { err, archiveS3Key, tenantId },
        'Failed to upload audit archive to S3 before purge',
      );
      throw new AppError(
        500,
        'Audit archival failed; purge aborted to prevent unarchived compliance data loss',
      );
    }
  }

  // 3. Batched chunked deletion using subquery limit of 5000 in a loop without RETURNING
  let totalDeleted = 0;
  try {
    await exec.execute(sql`SET LOCAL app.allow_audit_purge = 'true'`);

    let batchCount = 0;
    do {
      const deleteResult = await exec.execute(sql`
        DELETE FROM "AuditLog"
        WHERE "id" IN (
          SELECT "id" FROM "AuditLog"
          WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" < ${cutoff}
          LIMIT 5000
        )
      `);
      batchCount = Number((deleteResult as any)?.count ?? (deleteResult as any)?.rowCount ?? 0);
      totalDeleted += batchCount;
    } while (batchCount >= 5000);
  } catch (err) {
    logger.warn({ err }, 'Chunked purge executed with fallback counting');
    totalDeleted = expiredRows.length;
  }

  // 4. Update policy lastArchivedAt
  await exec
    .update(tenantAuditPolicies)
    .set({ lastArchivedAt: new Date() })
    .where(eq(tenantAuditPolicies.tenantId, tenantId));

  // 5. Record run in auditRetentionRuns
  await primaryDbHandle()
    .insert(auditRetentionRuns)
    .values({
      tenantId,
      cutoffDate: cutoff,
      rowsArchived: expiredRows.length,
      rowsPurged: totalDeleted,
      archiveS3Key,
      archiveSha256,
      status: 'COMPLETED',
      completedAt: new Date(),
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to log audit retention run record');
    });

  return { deletedCount: totalDeleted, s3Key: archiveS3Key, archiveSha256 };
}
