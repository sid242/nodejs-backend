import { and, arrayContains, count, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import { assertTenantScope, tenantDb } from '@/db/tenancy/context';
import {
  fileFolders,
  files,
  fileShares,
  fileVersions,
  type FileFolderRecord,
  type FileRecord,
  type FileShareRecord,
  type FileVersionRecord,
  type NewFileFolderRecord,
  type NewFileRecord,
  type NewFileShareRecord,
  type NewFileVersionRecord,
} from '@/db/schema/index';

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function findById(
  id: string,
  tenantId?: string,
  includeDeleted = false,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord | null> {
  assertTenantScope(tenantId);
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  if (!includeDeleted) {
    conditions.push(eq(files.isDeleted, false));
  }
  const [file] = await executor
    .select()
    .from(files)
    .where(and(...conditions))
    .limit(1);
  return file ?? null;
}

export async function createFile(
  data: NewFileRecord,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord> {
  assertTenantScope(data.tenantId);
  const [file] = await executor.insert(files).values(data).returning();
  return file as FileRecord;
}

export interface UpdateStatusAndSizeOptions {
  status: 'PENDING' | 'UPLOADED';
  size?: number | null;
  checksumSha256?: string | null;
  etag?: string | null;
}

export async function updateStatusAndSize(
  id: string,
  { status, size, checksumSha256, etag }: UpdateStatusAndSizeOptions,
  tenantId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord | null> {
  assertTenantScope(tenantId);
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  const updatePayload: Partial<NewFileRecord> = { status, size, updatedAt: new Date() };
  if (checksumSha256 !== undefined) updatePayload.checksumSha256 = checksumSha256;
  if (etag !== undefined) updatePayload.etag = etag;

  const [updated] = await executor
    .update(files)
    .set(updatePayload)
    .where(and(...conditions))
    .returning();
  return updated ?? null;
}

export interface UpdateFileOptions {
  filename?: string;
  description?: string | null;
  tags?: string[];
  folderId?: string | null;
  visibility?: 'PRIVATE' | 'TENANT' | 'PUBLIC_LINK';
  scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED';
  scannedAt?: Date;
  version?: number;
  key?: string;
  size?: number | null;
  checksumSha256?: string | null;
}

export async function updateFile(
  id: string,
  data: UpdateFileOptions,
  tenantId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord | null> {
  assertTenantScope(tenantId);
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  const [updated] = await executor
    .update(files)
    .set({ ...data, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  return updated ?? null;
}

export async function incrementDownloadCount(
  id: string,
  tenantId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<void> {
  assertTenantScope(tenantId);
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  await executor
    .update(files)
    .set({
      downloadCount: sql`${files.downloadCount} + 1`,
      lastAccessedAt: new Date(),
    })
    .where(and(...conditions));
}

export interface ListFilesOptions {
  tenantId: string;
  folderId?: string | null;
  search?: string;
  tag?: string;
  isDeleted?: boolean;
  scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED';
  limit?: number;
  offset?: number;
}

export async function findFiles(
  {
    tenantId,
    folderId,
    search,
    tag,
    isDeleted = false,
    scanStatus,
    limit = 50,
    offset = 0,
  }: ListFilesOptions,
  executor: DbExecutor = tenantDb(),
): Promise<{ items: FileRecord[]; total: number }> {
  assertTenantScope(tenantId);
  const conditions = [eq(files.tenantId, tenantId), eq(files.isDeleted, isDeleted)];

  if (folderId !== undefined) {
    if (folderId === 'root' || folderId === null) {
      conditions.push(isNull(files.folderId));
    } else {
      conditions.push(eq(files.folderId, folderId));
    }
  }

  if (search?.trim()) {
    conditions.push(ilike(files.filename, `%${search.trim()}%`));
  }

  if (tag?.trim()) {
    conditions.push(arrayContains(files.tags, [tag.trim()]));
  }

  if (scanStatus) {
    conditions.push(eq(files.scanStatus, scanStatus));
  }

  const [totalRes] = await executor
    .select({ count: count() })
    .from(files)
    .where(and(...conditions));
  const total = Number(totalRes?.count ?? 0);

  const items = await executor
    .select()
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.createdAt))
    .limit(limit)
    .offset(offset);

  return { items, total };
}

export async function findByOwnerId(
  ownerId: string,
  limit = 100,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord[]> {
  return executor
    .select()
    .from(files)
    .where(and(eq(files.ownerId, ownerId), eq(files.isDeleted, false)))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function findAll(
  limit = 100,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord[]> {
  return executor
    .select()
    .from(files)
    .where(eq(files.isDeleted, false))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function findByTenantId(
  tenantId: string,
  limit = 100,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord[]> {
  assertTenantScope(tenantId);
  return executor
    .select()
    .from(files)
    .where(and(eq(files.tenantId, tenantId), eq(files.isDeleted, false)))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function softDeleteFile(
  id: string,
  tenantId: string,
  deletedByMemberId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<boolean> {
  assertTenantScope(tenantId);
  const [updated] = await executor
    .update(files)
    .set({
      isDeleted: true,
      deletedAt: new Date(),
      deletedByMemberId: deletedByMemberId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(files.id, id), eq(files.tenantId, tenantId), eq(files.isDeleted, false)))
    .returning();
  return !!updated;
}

export async function restoreFile(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord | null> {
  assertTenantScope(tenantId);
  const [restored] = await executor
    .update(files)
    .set({
      isDeleted: false,
      deletedAt: null,
      deletedByMemberId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(files.id, id), eq(files.tenantId, tenantId), eq(files.isDeleted, true)))
    .returning();
  return restored ?? null;
}

export async function deleteById(
  id: string,
  tenantId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<void> {
  assertTenantScope(tenantId);
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  await executor.delete(files).where(and(...conditions));
}

export async function reassignOwnerFiles(
  tenantId: string,
  oldOwnerId: string,
  newOwnerId: string,
  executor: DbExecutor = tenantDb(),
): Promise<number> {
  assertTenantScope(tenantId);
  const result = await executor
    .update(files)
    .set({ ownerId: newOwnerId })
    .where(and(eq(files.tenantId, tenantId), eq(files.ownerId, oldOwnerId)))
    .returning({ id: files.id });
  return result?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createFolder(
  data: NewFileFolderRecord,
  executor: DbExecutor = tenantDb(),
): Promise<FileFolderRecord> {
  assertTenantScope(data.tenantId);
  const [folder] = await executor.insert(fileFolders).values(data).returning();
  return folder as FileFolderRecord;
}

export async function findFoldersByTenantId(
  tenantId: string,
  parentId?: string | null,
  executor: DbExecutor = tenantDb(),
): Promise<FileFolderRecord[]> {
  assertTenantScope(tenantId);
  const conditions = [eq(fileFolders.tenantId, tenantId)];
  if (parentId !== undefined) {
    if (parentId === null || parentId === 'root') {
      conditions.push(isNull(fileFolders.parentId));
    } else {
      conditions.push(eq(fileFolders.parentId, parentId));
    }
  }
  return executor
    .select()
    .from(fileFolders)
    .where(and(...conditions))
    .orderBy(fileFolders.name);
}

export async function findFolderById(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileFolderRecord | null> {
  assertTenantScope(tenantId);
  const [folder] = await executor
    .select()
    .from(fileFolders)
    .where(and(eq(fileFolders.id, id), eq(fileFolders.tenantId, tenantId)))
    .limit(1);
  return folder ?? null;
}

export async function updateFolder(
  id: string,
  tenantId: string,
  data: { name?: string; parentId?: string | null; color?: string | null },
  executor: DbExecutor = tenantDb(),
): Promise<FileFolderRecord | null> {
  assertTenantScope(tenantId);
  const [updated] = await executor
    .update(fileFolders)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(fileFolders.id, id), eq(fileFolders.tenantId, tenantId)))
    .returning();
  return updated ?? null;
}

export async function deleteFolder(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<void> {
  assertTenantScope(tenantId);
  await executor
    .delete(fileFolders)
    .where(and(eq(fileFolders.id, id), eq(fileFolders.tenantId, tenantId)));
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

export async function createShare(
  data: NewFileShareRecord,
  executor: DbExecutor = tenantDb(),
): Promise<FileShareRecord> {
  assertTenantScope(data.tenantId);
  const [share] = await executor.insert(fileShares).values(data).returning();
  return share as FileShareRecord;
}

export async function findShareByTokenHash(
  tokenHash: string,
  executor: DbExecutor = tenantDb(),
): Promise<(FileShareRecord & { file: FileRecord }) | null> {
  const [row] = await executor
    .select({
      share: fileShares,
      file: files,
    })
    .from(fileShares)
    .innerJoin(files, eq(fileShares.fileId, files.id))
    .where(eq(fileShares.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  return { ...row.share, file: row.file };
}

export async function findSharesByFileId(
  fileId: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileShareRecord[]> {
  assertTenantScope(tenantId);
  return executor
    .select()
    .from(fileShares)
    .where(and(eq(fileShares.fileId, fileId), eq(fileShares.tenantId, tenantId)))
    .orderBy(desc(fileShares.createdAt));
}

export async function deleteShare(
  id: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<void> {
  assertTenantScope(tenantId);
  await executor
    .delete(fileShares)
    .where(and(eq(fileShares.id, id), eq(fileShares.tenantId, tenantId)));
}

export async function incrementShareDownloadCount(
  id: string,
  executor: DbExecutor = tenantDb(),
): Promise<void> {
  await executor
    .update(fileShares)
    .set({ downloadCount: sql`${fileShares.downloadCount} + 1` })
    .where(eq(fileShares.id, id));
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function createVersion(
  data: NewFileVersionRecord,
  executor: DbExecutor = tenantDb(),
): Promise<FileVersionRecord> {
  assertTenantScope(data.tenantId);
  const [ver] = await executor.insert(fileVersions).values(data).returning();
  return ver as FileVersionRecord;
}

export async function findVersionsByFileId(
  fileId: string,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileVersionRecord[]> {
  assertTenantScope(tenantId);
  return executor
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.tenantId, tenantId)))
    .orderBy(desc(fileVersions.versionNumber));
}

export async function findVersion(
  fileId: string,
  versionNumber: number,
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileVersionRecord | null> {
  assertTenantScope(tenantId);
  const [ver] = await executor
    .select()
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.fileId, fileId),
        eq(fileVersions.versionNumber, versionNumber),
        eq(fileVersions.tenantId, tenantId),
      ),
    )
    .limit(1);
  return ver ?? null;
}

// ---------------------------------------------------------------------------
// Storage Analytics
// ---------------------------------------------------------------------------

export interface TenantStorageStats {
  totalBytes: number;
  totalFiles: number;
  deletedFiles: number;
  categoryBreakdown: {
    category: string;
    bytes: number;
    count: number;
  }[];
}

export async function getTenantStorageStats(
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<TenantStorageStats> {
  assertTenantScope(tenantId);
  const fileRows = await executor
    .select({
      size: files.size,
      contentType: files.contentType,
      isDeleted: files.isDeleted,
    })
    .from(files)
    .where(eq(files.tenantId, tenantId));

  let totalBytes = 0;
  let totalFiles = 0;
  let deletedFiles = 0;
  const categories: Record<string, { bytes: number; count: number }> = {
    images: { bytes: 0, count: 0 },
    documents: { bytes: 0, count: 0 },
    archives: { bytes: 0, count: 0 },
    other: { bytes: 0, count: 0 },
  };

  for (const r of fileRows) {
    if (r.isDeleted) {
      deletedFiles++;
      continue;
    }
    const bytes = Number(r.size ?? 0);
    totalBytes += bytes;
    totalFiles++;

    const ct = (r.contentType || '').toLowerCase();
    let cat = 'other';
    if (ct.startsWith('image/')) cat = 'images';
    else if (ct.includes('pdf') || ct.includes('word') || ct.includes('sheet') || ct.includes('text'))
      cat = 'documents';
    else if (ct.includes('zip') || ct.includes('tar') || ct.includes('compressed'))
      cat = 'archives';

    categories[cat]!.bytes += bytes;
    categories[cat]!.count += 1;
  }

  const categoryBreakdown = Object.entries(categories).map(([category, stats]) => ({
    category,
    bytes: stats.bytes,
    count: stats.count,
  }));

  return { totalBytes, totalFiles, deletedFiles, categoryBreakdown };
}
