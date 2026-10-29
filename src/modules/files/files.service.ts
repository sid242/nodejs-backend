import { randomUUID } from 'node:crypto';
import type { PresignedPost } from '@aws-sdk/s3-presigned-post';

import { logger } from '@/config/logger';
import type { FileRecord } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { createDownloadUrl, createUploadPost, deleteObject, headObject } from '@/lib/s3';
import { safeFilename } from '@/lib/utils';
import { ALLOWED_TYPES, type RequestUploadDto } from '@/modules/files/files.dto';
import * as fileRepo from '@/modules/files/files.repository';
import { fileQueue } from '@/queues/index';

export { ALLOWED_TYPES };

export interface RequestUploadResult {
  fileId: string;
  upload: PresignedPost;
}

export interface DownloadUrlResult {
  url: string;
  expiresInSeconds: number;
}

async function getOwned(
  userId: string,
  id: string,
  tenantId?: string,
): Promise<FileRecord> {
  const file = await fileRepo.findById(id, tenantId);
  // 404 (not 403) so we don't leak the existence of other users'/tenants' files.
  if (!file) {
    throw AppError.notFound('File not found');
  }

  // If the file belongs to a tenant workspace
  if (file.tenantId) {
    if (tenantId && file.tenantId !== tenantId) {
      throw AppError.notFound('File not found');
    }
    if (!tenantId && file.ownerId !== userId) {
      throw AppError.notFound('File not found');
    }
    return file;
  }

  // Personal / non-tenant file: only the owner has access
  if (file.ownerId !== userId) {
    throw AppError.notFound('File not found');
  }

  return file;
}

/** Step 1: client asks for permission to upload -> gets a short-lived presigned POST. */
export async function requestUpload(
  userId: string,
  { filename, contentType }: RequestUploadDto,
  tenantId?: string,
): Promise<RequestUploadResult> {
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required for file upload');
  }

  const key = `uploads/tenants/${tenantId}/${randomUUID()}-${safeFilename(filename)}`;

  const file = await fileRepo.createFile({
    key,
    filename,
    contentType,
    ownerId: userId,
    tenantId,
  });

  try {
    const upload = await createUploadPost({ key, contentType });
    return { fileId: file.id, upload }; // client POSTs { ...upload.fields, file } to upload.url
  } catch (uploadErr) {
    // Compensating action: prune orphaned database record if storage initialization fails
    await fileRepo.deleteById(file.id).catch(() => {});
    throw uploadErr;
  }
}

/** Step 3: after the browser finished uploading to S3, verify the object exists and kick off processing. */
export async function confirmUpload(
  userId: string,
  id: string,
  tenantId?: string,
): Promise<FileRecord> {
  const file = await getOwned(userId, id, tenantId);
  if (file.status === 'UPLOADED') return file;

  const head = await headObject(file.key).catch(() => null);
  if (!head) throw AppError.badRequest('Upload not found in storage yet');

  const resolvedTenantId = file.tenantId ?? tenantId;
  const updated = await fileRepo.updateStatusAndSize(
    id,
    {
      status: 'UPLOADED',
      size: head.ContentLength,
    },
    resolvedTenantId,
  );
  if (!updated) throw AppError.notFound('File not found');
  try {
    await fileQueue.add(
      'process',
      { fileId: id, ownerId: userId, tenantId: file.tenantId },
      { jobId: `process-${id}` },
    );
  } catch (queueErr) {
    logger.error(
      { err: queueErr, fileId: id },
      'Failed to enqueue file processing job; reverting status to PENDING',
    );
    await fileRepo
      .updateStatusAndSize(id, { status: 'PENDING', size: null }, resolvedTenantId)
      .catch(() => {});
    throw AppError.internal('Failed to queue file processing, please retry');
  }
  return updated;
}

export async function getDownloadUrl(
  userId: string,
  id: string,
  tenantId?: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): Promise<DownloadUrlResult> {
  const file = await getOwned(userId, id, tenantId);
  if (file.status !== 'UPLOADED') throw AppError.badRequest('File not uploaded yet');
  return {
    url: await createDownloadUrl(file.key, 300, {
      filename: file.filename,
      disposition,
    }),
    expiresInSeconds: 300,
  };
}

export const listFiles = (
  userId: string,
  tenantId?: string,
): Promise<FileRecord[]> => {
  if (tenantId) {
    return fileRepo.findByTenantId(tenantId);
  }
  return fileRepo.findByOwnerId(userId);
};

export async function deleteFile(
  userId: string,
  id: string,
  tenantId?: string,
): Promise<void> {
  const file = await getOwned(userId, id, tenantId);
  // Idempotent and recoverable deletion: tolerates missing storage objects and AWS timeouts
  try {
    await deleteObject(file.key);
  } catch (storageErr) {
    logger.warn(
      { err: storageErr, fileId: id, key: file.key },
      'Storage deletion warning during file removal; proceeding with DB deletion',
    );
  }
  await fileRepo.deleteById(id);
}
