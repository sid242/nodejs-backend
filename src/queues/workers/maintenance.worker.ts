import type { Job } from 'bullmq';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
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

  throw new Error(`Unknown maintenance job: ${job.name}`);
}
