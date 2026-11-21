import type { Job } from 'bullmq';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import * as schema from '@/db/schema';
import { files, platformSupportSessions, subscriptions } from '@/db/schema';
import { deleteObject } from '@/lib/s3';
import { forEachConcurrent } from '@/lib/utils';

export async function processMaintenance(job: Job): Promise<{ removed: number; failed: number }> {
  if (job.name === 'cleanup-pending-files') {
    // Uploads that were requested but never confirmed within 24h.
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const stale = await db
      .select({ id: files.id, key: files.key })
      .from(files)
      .where(and(eq(files.status, 'PENDING'), lt(files.createdAt, cutoff)))
      .orderBy(asc(files.createdAt))
      .limit(env.MAINTENANCE_BATCH_SIZE);
    const deletedIds: string[] = [];
    await forEachConcurrent(stale, env.S3_DELETE_CONCURRENCY, async (file) => {
      try {
        // S3 DeleteObject is also successful when the object never existed.
        await deleteObject(file.key);
        deletedIds.push(file.id);
      } catch (err) {
        logger.warn({ err, key: file.key }, 'stale object deletion failed; will retry');
      }
    });
    if (deletedIds.length) await db.delete(files).where(inArray(files.id, deletedIds));
    logger.info(
      { removed: deletedIds.length, failed: stale.length - deletedIds.length },
      'cleaned up stale pending files',
    );
    return { removed: deletedIds.length, failed: stale.length - deletedIds.length };
  }

  if (job.name === 'expire-support-sessions') {
    const now = new Date();
    const expired = await db
      .update(platformSupportSessions)
      .set({ status: 'EXPIRED', endedAt: now })
      .where(and(eq(platformSupportSessions.status, 'ACTIVE'), lt(platformSupportSessions.expiresAt, now)))
      .returning();
    if (expired.length > 0) {
      logger.info({ count: expired.length }, 'Expired stale platform support sessions');
    }
    return { removed: expired.length, failed: 0 };
  }

  if (job.name === 'expire-trialing-subscriptions') {
    const now = new Date();
    const expiredTrials = await db
      .update(subscriptions)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(and(eq(subscriptions.status, 'TRIALING'), lt(subscriptions.trialEndsAt, now)))
      .returning();
    if (expiredTrials.length > 0) {
      logger.info({ count: expiredTrials.length }, 'Marked expired trialing subscriptions as EXPIRED');
    }
    return { removed: expiredTrials.length, failed: 0 };
  }

  if (job.name === 'billing-dunning') {
    const now = new Date();
    // Subscriptions that are PAST_DUE past the 7-day grace period become CANCELED / SUSPENDED
    const graceCutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const pastDueOverGrace = await db
      .update(subscriptions)
      .set({ status: 'CANCELED', updatedAt: now })
      .where(and(eq(subscriptions.status, 'PAST_DUE'), lt(subscriptions.updatedAt, graceCutoff)))
      .returning();

    if (pastDueOverGrace.length > 0) {
      logger.warn(
        { count: pastDueOverGrace.length, subscriptionIds: pastDueOverGrace.map((s) => s.id) },
        'Suspended past-due subscriptions after 7-day grace period',
      );
    }
    return { removed: pastDueOverGrace.length, failed: 0 };
  }

  if (job.name === 'cleanup-stale-db-operations') {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    const staleOps = await db
      .update(schema.tenantDbOperations)
      .set({
        status: 'FAILED',
        finishedAt: new Date(),
        error: 'Operation timed out after remaining in RUNNING state for more than 2 hours',
      })
      .where(
        and(
          eq(schema.tenantDbOperations.status, 'RUNNING'),
          lt(schema.tenantDbOperations.startedAt, twoHoursAgo),
        ),
      )
      .returning();
    if (staleOps.length > 0) {
      logger.warn({ count: staleOps.length }, 'Marked stale database operations as FAILED');
    }
    return { removed: staleOps.length, failed: 0 };
  }

  if (job.name === 'domain-reverify') {
    const { reverifyAllVerifiedDomains } = await import('@/modules/tenants/tenants.service');
    const result = await reverifyAllVerifiedDomains();
    logger.info(result, 'Completed periodic custom domain re-verification');
    return { removed: result.failed, failed: 0 };
  }

  if (job.name === 'process-outbox-events') {
    const { processOutboxEvents } = await import('@/queues/workers/outbox.worker');
    const result = await processOutboxEvents(job);
    return { removed: result.processed, failed: result.failed };
  }

  if (job.name === 'audit-retention-purge') {
    const { purgeTenantExpiredLogs } = await import('@/modules/audit/audit.service');
    const allTenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
    let totalPurged = 0;
    for (const t of allTenants) {
      try {
        const res = await purgeTenantExpiredLogs(t.id);
        totalPurged += res.deletedCount;
      } catch (err) {
        logger.error({ err, tenantId: t.id }, 'Audit retention purge failed for tenant');
      }
    }
    return { removed: totalPurged, failed: 0 };
  }

  if (job.name === 'verify-audit-chains') {
    const { verifyAuditChain } = await import('@/modules/audit/audit.service');
    const allTenants = await db
      .select({ id: schema.tenants.id, slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(eq(schema.tenants.status, 'ACTIVE'));
    let brokenChains = 0;
    for (const t of allTenants) {
      try {
        const res = await verifyAuditChain(t.id);
        if (!res.verified) {
          brokenChains++;
          logger.error(
            { tenantId: t.id, tenantSlug: t.slug, err: res.error, brokenAtId: res.brokenAtId },
            '[ALERT] Tamper detection: Audit log hash chain verification failed for workspace!',
          );
        }
      } catch (err) {
        logger.error({ err, tenantId: t.id }, 'Audit chain verification job query failed');
      }
    }
    return { removed: 0, failed: brokenChains };
  }

  if (job.name === 'export-user-data') {
    const { processUserDataExport } = await import('@/modules/privacy/privacy.service');
    await processUserDataExport(job.data.requestId, job.data.userId);
    return { removed: 1, failed: 0 };
  }

  if (job.name === 'export-tenant-data') {
    const { processTenantDataExport } = await import('@/modules/privacy/privacy.service');
    await processTenantDataExport(job.data.requestId, job.data.tenantId);
    return { removed: 1, failed: 0 };
  }

  if (job.name === 'retention-sweep') {
    const { executeRetentionSweep } = await import('@/modules/privacy/privacy.service');
    const results = await executeRetentionSweep();
    return {
      removed:
        results.webhookDeliveriesCleaned +
        results.notificationsCleaned +
        results.emailMessagesCleaned +
        results.staleExportsCleaned,
      failed: 0,
    };
  }

  if (job.name === 'process-account-deletions') {
    const { processAccountDeletions } = await import('@/modules/privacy/privacy.service');
    const results = await processAccountDeletions();
    return { removed: results.anonymized, failed: results.skippedUnderHold };
  }

  if (job.name === 'process-tenant-purges') {
    const { processTenantPurges } = await import('@/modules/privacy/privacy.service');
    const results = await processTenantPurges();
    return { removed: results.purged, failed: results.skippedUnderHold };
  }

  if (job.name === 'aggregate-platform-metrics') {
    const { aggregateDailyPlatformSnapshot } = await import('@/modules/analytics/analytics.service');
    const result = await aggregateDailyPlatformSnapshot();
    return { removed: 1, failed: 0 };
  }

  throw new Error(`Unknown maintenance job: ${job.name}`);
}
