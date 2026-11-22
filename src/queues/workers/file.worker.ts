import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';

import { withTenantTransaction } from '@/db/tenancy/rls';
import { getTenantDb } from '@/lib/db-manager';
import { deleteObject, putObject, readUploadBytes } from '@/lib/s3';
import { scanFileBytes } from '@/modules/files/file-scanner';
import * as fileRepo from '@/modules/files/files.repository';
import { findTenantMember } from '@/modules/tenants/tenants.repository';
import { emitToWorkspaceUser } from '@/sockets/emitter';

export interface FileJobData {
  fileId: string;
  ownerId: string;
  tenantId?: string;
  version?: number;
}

export async function processFile(
  job: Job<FileJobData>,
): Promise<{ skipped?: boolean; ok?: boolean }> {
  const { fileId, ownerId, tenantId, version = 1 } = job.data;
  if (!tenantId) return { skipped: true };

  const targetDb = await getTenantDb(tenantId);
  const file = await withTenantTransaction(
    tenantId,
    () => fileRepo.findById(fileId, tenantId),
    targetDb,
  );
  if (
    !file ||
    file.ownerId !== ownerId ||
    file.version !== version ||
    file.status !== 'UPLOADED' ||
    file.scanStatus !== 'PENDING'
  ) {
    return { skipped: true };
  }

  const complete = (
    status: 'CLEAN' | 'INFECTED' | 'FAILED',
    verified?: {
      key: string;
      checksumSha256: string;
      size: number;
    },
  ) =>
    withTenantTransaction(
      tenantId,
      () => fileRepo.completeFileScan(file, status, verified),
      targetDb,
    );
  const notify = async (scanStatus: 'CLEAN' | 'INFECTED' | 'FAILED') => {
    const member = await findTenantMember(tenantId, ownerId);
    if (member?.status === 'ACTIVE') {
      emitToWorkspaceUser(tenantId, ownerId, 'file:processed', { fileId, tenantId, scanStatus });
    }
  };

  try {
    const bytes = await readUploadBytes(file.key);
    const status = await scanFileBytes(bytes);
    if (status === 'INFECTED') {
      if (await complete(status)) await notify(status);
      return { ok: true };
    }

    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    const key =
      'private-files/verified/' + tenantId + '/' + fileId + '/' + version + '/' + checksumSha256;
    await putObject(key, bytes, file.contentType);
    if (await complete(status, { key, checksumSha256, size: bytes.byteLength })) {
      if (file.key.startsWith('private-files/staging/'))
        await deleteObject(file.key).catch(() => {});
      await notify(status);
    }
    return { ok: true };
  } catch (error) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1) && (await complete('FAILED'))) {
      await notify('FAILED');
    }
    throw error;
  }
}
