import { eq, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema';
import { files, platformMetricsDaily, tenantUsageRecords, users } from '@/db/schema';
import { tenantDb } from '@/db/tenancy/context';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { createDownloadUrl, putObject } from '@/lib/s3';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import type { CreateReportDefinitionDto, RecordUsageEventDto } from './analytics.dto';
import * as analyticsRepo from './analytics.repository';

// -----------------------------------------------------------------------------
// Usage Metering
// -----------------------------------------------------------------------------

export async function recordUsage(
  tenantId: string,
  data: RecordUsageEventDto,
  actorMemberId?: string | null,
) {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // 1. Insert append-only event with idempotency support
  const event = await analyticsRepo.insertUsageEvent({
    tenantId,
    meter: data.meter,
    quantity: data.quantity,
    unit: data.unit ?? 'count',
    actorMemberId: actorMemberId ?? null,
    resourceType: data.resourceType ?? null,
    resourceId: data.resourceId ?? null,
    idempotencyKey: data.idempotencyKey ?? null,
  });

  // If already recorded via duplicate idempotencyKey, return early
  if (!event && data.idempotencyKey) {
    logger.debug(
      { tenantId, idempotencyKey: data.idempotencyKey },
      'Duplicate usage event skipped',
    );
    return null;
  }

  // 2. Update daily rollup
  await analyticsRepo.upsertUsageDaily({
    tenantId,
    meter: data.meter,
    date: today,
    quantity: data.quantity,
    unit: data.unit ?? 'count',
  });

  // 3. Update current total in TenantUsageRecord (for real-time entitlement checks)
  await db
    .insert(tenantUsageRecords)
    .values({
      tenantId,
      entitlementKey: data.meter,
      currentUsage: data.quantity,
      lastRecordedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tenantUsageRecords.tenantId, tenantUsageRecords.entitlementKey],
      set: {
        currentUsage: sql`${tenantUsageRecords.currentUsage} + ${data.quantity}`,
        lastRecordedAt: new Date(),
      },
    });

  // 4. Invalidate overview cache on significant usage
  await cache.del(`analytics:overview:${tenantId}:7d`, `analytics:overview:${tenantId}:30d`);

  return event;
}

export async function getTenantUsageRollup(
  tenantId: string,
  from?: string,
  to?: string,
  meter?: string,
) {
  return analyticsRepo.getDailyUsageRollup(tenantId, from, to, meter);
}

// -----------------------------------------------------------------------------
// Tenant Analytics Dashboard Overview (Cached 5 min)
// -----------------------------------------------------------------------------

export async function getAnalyticsOverview(tenantId: string, range: '7d' | '30d' | '90d' = '30d') {
  const cacheKey = `analytics:overview:${tenantId}:${range}`;
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;

  return cache.wrap(cacheKey, 300, async () => {
    logger.debug({ tenantId, range }, 'Computing analytics overview');

    const [activeMembers, logins, roles, storage, invites, security, recentActivity] =
      await Promise.all([
        analyticsRepo.getActiveMemberCounts(tenantId),
        analyticsRepo.getLoginsByDay(tenantId, days),
        analyticsRepo.getRoleDistribution(tenantId),
        analyticsRepo.getStorageStats(tenantId),
        analyticsRepo.getInviteStats(tenantId),
        analyticsRepo.getSecurityPosture(tenantId),
        analyticsRepo.getActivityFeed(tenantId, { limit: 5 }),
      ]);

    return {
      range,
      activeMembers,
      loginsByDay: logins,
      roleDistribution: roles,
      storage,
      inviteConversion: invites,
      securityPosture: security,
      recentActivity,
      generatedAt: new Date().toISOString(),
    };
  });
}

// -----------------------------------------------------------------------------
// Activity Feed
// -----------------------------------------------------------------------------

export async function recordActivity(
  tenantId: string,
  data: {
    actorId?: string | null;
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    verb: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    metadata?: Record<string, any>;
  },
) {
  return analyticsRepo.insertActivityFeedItem({
    tenantId,
    actorId: data.actorId ?? null,
    actorName: data.actorName ?? null,
    actorAvatarUrl: data.actorAvatarUrl ?? null,
    verb: data.verb,
    entityType: data.entityType,
    entityId: data.entityId ?? null,
    summary: data.summary,
    metadata: data.metadata ?? {},
  });
}

export async function getActivityFeed(
  tenantId: string,
  options?: { limit?: number; cursor?: string; entityType?: string },
) {
  return analyticsRepo.getActivityFeed(tenantId, options);
}

// -----------------------------------------------------------------------------
// Reports & Exports
// -----------------------------------------------------------------------------

export async function createReportDefinition(
  tenantId: string,
  data: CreateReportDefinitionDto,
  userId: string,
) {
  const definition = await analyticsRepo.createReportDefinition({
    tenantId,
    name: data.name,
    type: data.type,
    filters: data.filters,
    columns: data.columns,
    format: data.format,
    schedule: data.schedule,
    recipients: data.recipients,
    createdBy: userId,
  });

  if (!definition) {
    throw AppError.internal('Failed to create report definition');
  }

  await logSecurityEvent({
    tenantId,
    actorUserId: userId,
    userId,
    actorType: 'USER',
    action: 'analytics:report_definition_created',
    resourceType: 'ReportDefinition',
    resourceId: definition.id,
    metadata: { name: definition.name, type: definition.type },
  });

  return definition;
}

export async function listReportDefinitions(tenantId: string) {
  return analyticsRepo.listReportDefinitions(tenantId);
}

export async function triggerReportRun(tenantId: string, definitionId: string, userId: string) {
  const definition = await analyticsRepo.getReportDefinitionById(definitionId, tenantId);
  if (!definition) {
    throw AppError.notFound('Report definition not found');
  }

  const run = await analyticsRepo.createReportRun({
    tenantId,
    definitionId,
    status: 'RUNNING',
  });

  if (!run) {
    throw AppError.internal('Failed to initiate report run');
  }

  try {
    let rows: Record<string, any>[] = [];

    if (definition.type === 'MEMBERS') {
      const members = await tenantDb()
        .select({
          id: schema.tenantMembers.id,
          userId: schema.tenantMembers.userId,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          status: schema.tenantMembers.status,
          joinedAt: schema.tenantMembers.joinedAt,
        })
        .from(schema.tenantMembers)
        .innerJoin(users, eq(schema.tenantMembers.userId, users.id))
        .where(eq(schema.tenantMembers.tenantId, tenantId));
      rows = members;
    } else if (definition.type === 'FILES') {
      const tenantFiles = await tenantDb()
        .select({
          id: files.id,
          filename: files.filename,
          contentType: files.contentType,
          size: files.size,
          status: files.status,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(eq(files.tenantId, tenantId))
        .limit(1000);
      rows = tenantFiles;
    } else if (definition.type === 'USAGE') {
      const usage = await analyticsRepo.getDailyUsageRollup(tenantId);
      rows = usage;
    } else if (definition.type === 'SECURITY') {
      const securityRows = await tenantDb()
        .select({
          memberId: schema.tenantMembers.id,
          email: users.email,
          twoFactorEnabled: users.twoFactorEnabledAt,
          lastLoginAt: schema.tenantMembers.lastLoginAt,
          status: schema.tenantMembers.status,
        })
        .from(schema.tenantMembers)
        .innerJoin(users, eq(schema.tenantMembers.userId, users.id))
        .where(eq(schema.tenantMembers.tenantId, tenantId));
      rows = securityRows;
    } else {
      // General activity / audit fallback
      const activity = await analyticsRepo.getActivityFeed(tenantId, { limit: 100 });
      rows = activity;
    }

    const rowCount = rows.length;
    let fileContent = '';
    let contentType = 'text/csv';
    const ext = definition.format === 'JSON' ? 'json' : 'csv';

    if (definition.format === 'JSON') {
      fileContent = JSON.stringify(rows, null, 2);
      contentType = 'application/json';
    } else {
      // CSV serialization
      if (rows.length > 0) {
        const headers = Object.keys(rows[0] || {});
        const csvLines = [headers.join(',')];
        for (const row of rows) {
          const values = headers.map((h) => {
            const val = row[h];
            if (val === null || val === undefined) return '';
            const escaped = String(val).replace(/"/g, '""');
            return `"${escaped}"`;
          });
          csvLines.push(values.join(','));
        }
        fileContent = csvLines.join('\n');
      } else {
        fileContent = 'No data\n';
      }
    }

    const fileSizeBytes = Buffer.byteLength(fileContent, 'utf-8');
    const fileKey = `reports/${tenantId}/${definitionId}/${run.id}.${ext}`;

    await putObject(fileKey, fileContent, contentType, {
      tenantId,
      definitionId,
      runId: run.id,
    });

    const downloadUrl = await createDownloadUrl(fileKey, 24 * 3600, {
      disposition: 'attachment',
      filename: `report-${definition.name.toLowerCase().replace(/\s+/g, '-')}-${run.id.slice(0, 8)}.${ext}`,
    });

    const updated = await analyticsRepo.updateReportRun(run.id, tenantId, {
      status: 'COMPLETED',
      fileKey,
      downloadUrl,
      rowCount,
      fileSizeBytes,
      finishedAt: new Date(),
    });

    await logSecurityEvent({
      tenantId,
      actorUserId: userId,
      userId,
      actorType: 'USER',
      action: 'analytics:report_run_completed',
      resourceType: 'ReportRun',
      resourceId: run.id,
      metadata: { rowCount, fileSizeBytes, format: definition.format },
    });

    return updated;
  } catch (err: any) {
    logger.error({ err, runId: run.id, definitionId }, 'Report run generation failed');
    return analyticsRepo.updateReportRun(run.id, tenantId, {
      status: 'FAILED',
      error: err?.message || 'Report run failed',
      finishedAt: new Date(),
    });
  }
}

export async function listReportRuns(tenantId: string, definitionId?: string) {
  return analyticsRepo.listReportRuns(tenantId, definitionId);
}

// -----------------------------------------------------------------------------
// Platform Executive Metrics
// -----------------------------------------------------------------------------

export async function getPlatformMetricsOverview() {
  const kpis = await analyticsRepo.getPlatformOverviewKPIs();
  const dailyTrends = await analyticsRepo.listPlatformDailyMetrics(30);

  return {
    kpis,
    dailyTrends,
    updatedAt: new Date().toISOString(),
  };
}

export async function aggregateDailyPlatformSnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  logger.info({ date: today }, 'Aggregating daily platform metrics snapshot');

  const kpis = await analyticsRepo.getPlatformOverviewKPIs();

  await db
    .insert(platformMetricsDaily)
    .values({
      date: today,
      mrrCents: 0,
      arrCents: 0,
      activeTenants: kpis.activeTenants,
      newTenants: 0,
      churnedTenants: 0,
      totalStorageBytes: kpis.totalStorageBytes,
      apiRequestsCount: 0,
    })
    .onConflictDoUpdate({
      target: [platformMetricsDaily.date],
      set: {
        activeTenants: kpis.activeTenants,
        totalStorageBytes: kpis.totalStorageBytes,
      },
    });

  return { date: today, activeTenants: kpis.activeTenants };
}
