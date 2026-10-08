import type { Job } from 'bullmq';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { files } from '@/db/schema/index.js';
import { deleteObject } from '@/lib/s3.js';
import { forEachConcurrent } from '@/lib/utils.js';
import { logger } from '@/config/logger.js';
import { env } from '@/config/env.js';

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
  throw new Error(`Unknown maintenance job: ${job.name}`);
}
