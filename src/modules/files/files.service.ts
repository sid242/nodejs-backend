import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PresignedPost } from '@aws-sdk/s3-presigned-post';
import bcrypt from 'bcryptjs';

import { logger } from '@/config/logger';
import type { FileFolderRecord, FileRecord, FileShareRecord, FileVersionRecord } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { createDownloadUrl, createUploadPost, deleteObject, headObject } from '@/lib/s3';
import { safeFilename } from '@/lib/utils';
import {
  ALLOWED_TYPES,
  type CreateFolderDto,
  type CreateShareDto,
  type ListFilesQueryDto,
  type RequestUploadDto,
  type UpdateFileDto,
  type UpdateFolderDto,
} from '@/modules/files/files.dto';
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

export interface PublicShareAccessResult {
  file: {
    id: string;
    filename: string;
    contentType: string;
    size: number | null;
    createdAt: Date;
  };
  downloadUrl: string;
  expiresInSeconds: number;
}

export interface ShareCreationResult {
  shareId: string;
  token: string;
  expiresAt: Date | null;
  maxDownloads: number | null;
}

async function getOwned(
  userId: string,
  id: string,
  tenantId?: string,
  includeDeleted = false,
): Promise<FileRecord> {
  const file = await fileRepo.findById(id, tenantId, includeDeleted);
  if (!file) {
    throw AppError.notFound('File not found');
  }

  if (file.tenantId) {
    if (tenantId && file.tenantId !== tenantId) {
      throw AppError.notFound('File not found');
    }
    if (!tenantId && file.ownerId !== userId) {
      throw AppError.notFound('File not found');
    }
    return file;
  }

  if (file.ownerId !== userId) {
    throw AppError.notFound('File not found');
  }

  return file;
}

/** Step 1: client asks for permission to upload -> gets a short-lived presigned POST. */
export async function requestUpload(
  userId: string,
  dto: RequestUploadDto,
  tenantId?: string,
): Promise<RequestUploadResult> {
  if (!tenantId) {
    throw AppError.badRequest('Tenant context is required for file upload');
  }

  const fileId = randomUUID();
  const date = new Date();
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const sanitized = safeFilename(dto.filename);
  const key = `tenants/${tenantId}/${yyyy}/${mm}/${fileId}/${sanitized}`;

  if (dto.folderId) {
    const folder = await fileRepo.findFolderById(dto.folderId, tenantId);
    if (!folder) {
      throw AppError.badRequest('Target folder does not exist');
    }
  }

  const file = await fileRepo.createFile({
    id: fileId,
    key,
    filename: dto.filename,
    contentType: dto.contentType,
    folderId: dto.folderId ?? null,
    description: dto.description ?? null,
    tags: dto.tags ?? [],
    ownerId: userId,
    tenantId,
    scanStatus: 'PENDING',
    status: 'PENDING',
  });

  try {
    const upload = await createUploadPost({ key, contentType: dto.contentType });
    return { fileId: file.id, upload };
  } catch (uploadErr) {
    await fileRepo.deleteById(file.id, tenantId).catch(() => {});
    throw uploadErr;
  }
}

/** Step 3: verify the uploaded object exists and queue background virus scan and thumbnail generation. */
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
      etag: head.ETag?.replace(/"/g, ''),
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
  if (file.status !== 'UPLOADED') {
    throw AppError.badRequest('File not uploaded yet');
  }
  if (file.scanStatus === 'INFECTED') {
    throw AppError.forbidden('File is quarantined due to detected security risk');
  }

  const url = await createDownloadUrl(file.key, 300, {
    filename: file.filename,
    contentType: file.contentType,
    disposition,
  });

  await fileRepo.incrementDownloadCount(file.id, tenantId).catch(() => {});

  return {
    url,
    expiresInSeconds: 300,
  };
}

export async function listFiles(
  userId: string,
  tenantId?: string,
  query?: ListFilesQueryDto,
): Promise<{ items: FileRecord[]; total: number }> {
  if (tenantId) {
    return fileRepo.findFiles({
      tenantId,
      folderId: query?.folderId,
      search: query?.search,
      tag: query?.tag,
      isDeleted: query?.isDeleted ?? false,
      scanStatus: query?.scanStatus,
      limit: query?.limit ?? 50,
      offset: query?.offset ?? 0,
    });
  }
  const items = await fileRepo.findByOwnerId(userId);
  return { items, total: items.length };
}

export async function updateFile(
  userId: string,
  id: string,
  tenantId: string | undefined,
  dto: UpdateFileDto,
): Promise<FileRecord> {
  await getOwned(userId, id, tenantId);
  if (dto.folderId) {
    const folder = await fileRepo.findFolderById(dto.folderId, tenantId!);
    if (!folder) throw AppError.badRequest('Target folder does not exist');
  }

  const updated = await fileRepo.updateFile(id, dto, tenantId);
  if (!updated) throw AppError.notFound('File not found');
  return updated;
}

export async function deleteFile(
  userId: string,
  id: string,
  tenantId?: string,
  permanent = false,
): Promise<void> {
  const file = await getOwned(userId, id, tenantId, true);

  if (!permanent && !file.isDeleted) {
    await fileRepo.softDeleteFile(id, tenantId ?? file.tenantId);
    return;
  }

  // Hard delete: remove from storage & purge DB row
  try {
    await deleteObject(file.key);
  } catch (storageErr) {
    logger.warn(
      { err: storageErr, fileId: id, key: file.key },
      'Storage deletion warning during file removal; proceeding with DB deletion',
    );
  }
  await fileRepo.deleteById(id, tenantId);
}

export async function restoreFile(
  userId: string,
  id: string,
  tenantId: string,
): Promise<FileRecord> {
  const file = await getOwned(userId, id, tenantId, true);
  if (!file.isDeleted) {
    return file;
  }
  const restored = await fileRepo.restoreFile(id, tenantId);
  if (!restored) throw AppError.notFound('File not found in trash');
  return restored;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createFolder(
  userId: string,
  tenantId: string,
  dto: CreateFolderDto,
): Promise<FileFolderRecord> {
  if (dto.parentId) {
    const parent = await fileRepo.findFolderById(dto.parentId, tenantId);
    if (!parent) throw AppError.badRequest('Parent folder not found');
  }
  return fileRepo.createFolder({
    name: dto.name.trim(),
    parentId: dto.parentId ?? null,
    color: dto.color ?? null,
    tenantId,
    createdBy: userId,
  });
}

export async function listFolders(
  tenantId: string,
  parentId?: string | null,
): Promise<FileFolderRecord[]> {
  return fileRepo.findFoldersByTenantId(tenantId, parentId);
}

export async function getFolder(tenantId: string, id: string): Promise<FileFolderRecord> {
  const folder = await fileRepo.findFolderById(id, tenantId);
  if (!folder) throw AppError.notFound('Folder not found');
  return folder;
}

export async function updateFolder(
  tenantId: string,
  id: string,
  dto: UpdateFolderDto,
): Promise<FileFolderRecord> {
  if (dto.parentId) {
    if (dto.parentId === id) throw AppError.badRequest('Folder cannot be parent of itself');
    const parent = await fileRepo.findFolderById(dto.parentId, tenantId);
    if (!parent) throw AppError.badRequest('Parent folder not found');
  }
  const updated = await fileRepo.updateFolder(id, tenantId, dto);
  if (!updated) throw AppError.notFound('Folder not found');
  return updated;
}

export async function deleteFolder(tenantId: string, id: string): Promise<void> {
  const folder = await fileRepo.findFolderById(id, tenantId);
  if (!folder) throw AppError.notFound('Folder not found');
  await fileRepo.deleteFolder(id, tenantId);
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export async function createShare(
  userId: string,
  tenantId: string,
  fileId: string,
  dto: CreateShareDto,
): Promise<ShareCreationResult> {
  const file = await getOwned(userId, fileId, tenantId);
  if (file.status !== 'UPLOADED') throw AppError.badRequest('Cannot share unconfirmed file');
  if (file.scanStatus === 'INFECTED') throw AppError.badRequest('Cannot share infected file');

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  let passwordHash: string | null = null;
  if (dto.password) {
    passwordHash = await bcrypt.hash(dto.password, 10);
  }

  let expiresAt: Date | null = null;
  if (dto.expiresInHours) {
    expiresAt = new Date(Date.now() + dto.expiresInHours * 3600 * 1000);
  }

  const share = await fileRepo.createShare({
    fileId: file.id,
    tenantId,
    tokenHash,
    passwordHash,
    maxDownloads: dto.maxDownloads ?? null,
    expiresAt,
    createdBy: userId,
  });

  return {
    shareId: share.id,
    token: rawToken,
    expiresAt: share.expiresAt,
    maxDownloads: share.maxDownloads,
  };
}

export async function listShares(
  userId: string,
  tenantId: string,
  fileId: string,
): Promise<FileShareRecord[]> {
  await getOwned(userId, fileId, tenantId);
  return fileRepo.findSharesByFileId(fileId, tenantId);
}

export async function revokeShare(
  userId: string,
  tenantId: string,
  fileId: string,
  shareId: string,
): Promise<void> {
  await getOwned(userId, fileId, tenantId);
  await fileRepo.deleteShare(shareId, tenantId);
}

export async function accessShare(
  token: string,
  password?: string,
): Promise<PublicShareAccessResult> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const share = await fileRepo.findShareByTokenHash(tokenHash);
  if (!share) {
    throw AppError.notFound('Shared file link not found or expired');
  }

  if (share.expiresAt && new Date() > share.expiresAt) {
    throw AppError.badRequest('Shared file link has expired');
  }

  if (share.maxDownloads && share.downloadCount >= share.maxDownloads) {
    throw AppError.badRequest('Maximum download limit reached for this share link');
  }

  if (share.passwordHash) {
    if (!password) {
      throw AppError.unauthorized('Password required to access this file');
    }
    const valid = await bcrypt.compare(password, share.passwordHash);
    if (!valid) {
      throw AppError.unauthorized('Invalid password');
    }
  }

  const downloadUrl = await createDownloadUrl(share.file.key, 300, {
    filename: share.file.filename,
    disposition: 'attachment',
  });

  await Promise.allSettled([
    fileRepo.incrementShareDownloadCount(share.id),
    fileRepo.incrementDownloadCount(share.file.id, share.tenantId),
  ]);

  return {
    file: {
      id: share.file.id,
      filename: share.file.filename,
      contentType: share.file.contentType,
      size: share.file.size,
      createdAt: share.file.createdAt,
    },
    downloadUrl,
    expiresInSeconds: 300,
  };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function listVersions(
  userId: string,
  tenantId: string,
  fileId: string,
): Promise<FileVersionRecord[]> {
  await getOwned(userId, fileId, tenantId);
  return fileRepo.findVersionsByFileId(fileId, tenantId);
}

export async function restoreVersion(
  userId: string,
  tenantId: string,
  fileId: string,
  versionNumber: number,
): Promise<FileRecord> {
  const file = await getOwned(userId, fileId, tenantId);
  const targetVer = await fileRepo.findVersion(fileId, versionNumber, tenantId);
  if (!targetVer) throw AppError.notFound(`Version ${versionNumber} not found`);

  // Snapshot current state as a new version history item
  await fileRepo.createVersion({
    fileId: file.id,
    tenantId,
    versionNumber: file.version,
    key: file.key,
    size: file.size,
    checksumSha256: file.checksumSha256,
    createdBy: userId,
  });

  // Roll file forward to target version content
  const updated = await fileRepo.updateFile(
    file.id,
    {
      key: targetVer.key,
      size: targetVer.size,
      checksumSha256: targetVer.checksumSha256,
      version: file.version + 1,
    },
    tenantId,
  );
  if (!updated) throw AppError.notFound('Failed to restore version');
  return updated;
}

// ---------------------------------------------------------------------------
// Storage Analytics
// ---------------------------------------------------------------------------

export async function getStorageStats(tenantId: string) {
  return fileRepo.getTenantStorageStats(tenantId);
}
