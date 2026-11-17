import type { Job } from 'bullmq';

import { runWithTenantDb } from '@/db/tenancy/context';
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

  const executeWork = async () => {
    const file = await fileRepo.findById(fileId, tenantId);
    if (!file) return { skipped: true };

    // Work (thumbnails, virus scan, OCR, video transcode)
    await job.updateProgress(100);

    // Push the result to the user's browser, regardless of which API node holds their socket.
    emitToUser(ownerId, 'file:processed', { fileId, tenantId });
    return { ok: true };
  };

  if (tenantId) {
    const targetDb = await getTenantDb(tenantId);
    return runWithTenantDb({ tenantId, db: targetDb }, executeWork);
  }

  return executeWork();
}
