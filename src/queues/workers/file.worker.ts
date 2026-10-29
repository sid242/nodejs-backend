import type { Job } from 'bullmq';

import { getTenantDb } from '@/lib/db-manager';
import * as fileRepo from '@/modules/files/files.repository';
import { emitToUser } from '@/sockets/emitter';

export interface FileJobData {
  fileId: string;
  ownerId: string;
  tenantId?: string;
}

export async function processFile(
  job: Job<FileJobData>,
): Promise<{ skipped?: boolean; ok?: boolean }> {
  const { fileId, ownerId, tenantId } = job.data;

  // Resolve target database connection (shared or dedicated enterprise database)
  const targetDb = tenantId ? await getTenantDb(tenantId) : undefined;
  const file = await fileRepo.findById(fileId, tenantId, targetDb);
  if (!file) return { skipped: true };

  // TODO: real work goes here (thumbnails with sharp, virus scan, OCR, video transcode...).
  await job.updateProgress(100);

  // Push the result to the user's browser, regardless of which API node holds their socket.
  emitToUser(ownerId, 'file:processed', { fileId, tenantId });
  return { ok: true };
}
