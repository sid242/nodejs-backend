import { randomUUID } from 'node:crypto';
import type { PresignedPost } from '@aws-sdk/s3-presigned-post';

import type { FileRecord } from '@/db/schema/index.js';
import { AppError } from '@/lib/errors.js';
import { createDownloadUrl, createUploadPost, deleteObject, headObject } from '@/lib/s3.js';
import { safeFilename } from '@/lib/utils.js';
import { ALLOWED_TYPES, type RequestUploadDto } from '@/modules/files/files.dto.js';
import * as fileRepo from '@/modules/files/files.repository.js';
import { fileQueue } from '@/queues/index.js';

export { ALLOWED_TYPES };

export interface RequestUploadResult {
  fileId: string;
  upload: PresignedPost;
}

export interface DownloadUrlResult {
  url: string;
  expiresInSeconds: number;
}

async function getOwned(userId: string, id: string, role?: string): Promise<FileRecord> {
  const file = await fileRepo.findById(id);
  // 404 (not 403) so we don't leak the existence of other users' files to non-admins.
  if (!file || (role !== 'ADMIN' && file.ownerId !== userId)) {
    throw AppError.notFound('File not found');
  }
  return file;
}

/** Step 1: client asks for permission to upload -> gets a short-lived presigned POST. */
export async function requestUpload(
  userId: string,
  { filename, contentType }: RequestUploadDto,
): Promise<RequestUploadResult> {
  const key = `uploads/${userId}/${randomUUID()}-${safeFilename(filename)}`;
  const file = await fileRepo.createFile({ key, filename, contentType, ownerId: userId });
  const upload = await createUploadPost({ key, contentType });
  return { fileId: file.id, upload }; // client POSTs { ...upload.fields, file } to upload.url
}

/** Step 3: after the browser finished uploading to S3, verify the object exists and kick off processing. */
export async function confirmUpload(userId: string, id: string): Promise<FileRecord> {
  const file = await getOwned(userId, id);
  if (file.status === 'UPLOADED') return file;

  const head = await headObject(file.key).catch(() => null);
  if (!head) throw AppError.badRequest('Upload not found in storage yet');

  const updated = await fileRepo.updateStatusAndSize(id, {
    status: 'UPLOADED',
    size: head.ContentLength,
  });
  if (!updated) throw AppError.notFound('File not found');
  await fileQueue.add('process', { fileId: id, ownerId: userId }, { jobId: `process-${id}` });
  return updated;
}

export async function getDownloadUrl(
  userId: string,
  id: string,
  role?: string,
): Promise<DownloadUrlResult> {
  const file = await getOwned(userId, id, role);
  if (file.status !== 'UPLOADED') throw AppError.badRequest('File not uploaded yet');
  return { url: await createDownloadUrl(file.key), expiresInSeconds: 300 };
}

export const listFiles = (userId: string, role?: string): Promise<FileRecord[]> => {
  if (role === 'ADMIN') {
    return fileRepo.findAll();
  }
  return fileRepo.findByOwnerId(userId);
};

export async function deleteFile(userId: string, id: string, role?: string): Promise<void> {
  const file = await getOwned(userId, id, role);
  await deleteObject(file.key);
  await fileRepo.deleteById(id);
}
