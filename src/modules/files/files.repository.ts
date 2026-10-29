
import { and, desc, eq } from 'drizzle-orm';

import { db, type DbExecutor } from '@/config/db';
import { files, type FileRecord, type NewFileRecord } from '@/db/schema/index';

export async function findById(
  id: string,
  tenantId?: string,
  executor: DbExecutor = db,
): Promise<FileRecord | null> {
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  const [file] = await executor
    .select()
    .from(files)
    .where(and(...conditions))
    .limit(1);
  return file ?? null;
}

export async function createFile(
  { key, filename, contentType, ownerId, tenantId }: NewFileRecord,
  executor: DbExecutor = db,
): Promise<FileRecord> {
  const [file] = await executor
    .insert(files)
    .values({ key, filename, contentType, ownerId, tenantId })
    .returning();
  return file as FileRecord;
}

export interface UpdateStatusAndSizeOptions {
  status: 'PENDING' | 'UPLOADED';
  size?: number | null;
}

export async function updateStatusAndSize(
  id: string,
  { status, size }: UpdateStatusAndSizeOptions,
  tenantId?: string,
  executor: DbExecutor = db,
): Promise<FileRecord | null> {
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  const [updated] = await executor
    .update(files)
    .set({ status, size })
    .where(and(...conditions))
    .returning();
  return updated ?? null;
}

export async function findByOwnerId(
  ownerId: string,
  limit = 100,
  executor: DbExecutor = db,
): Promise<FileRecord[]> {
  return executor
    .select()
    .from(files)
    .where(eq(files.ownerId, ownerId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function findAll(limit = 100, executor: DbExecutor = db): Promise<FileRecord[]> {
  return executor.select().from(files).orderBy(desc(files.createdAt)).limit(limit);
}

export async function findByTenantId(
  tenantId: string,
  limit = 100,
  executor: DbExecutor = db,
): Promise<FileRecord[]> {
  return executor
    .select()
    .from(files)
    .where(eq(files.tenantId, tenantId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function deleteById(id: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(files).where(eq(files.id, id));
}
