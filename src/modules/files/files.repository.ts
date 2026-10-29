import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { files, type FileRecord, type NewFileRecord } from '@/db/schema/index';

export async function findById(id: string, tenantId?: string): Promise<FileRecord | null> {
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  const [file] = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .limit(1);
  return file ?? null;
}

export async function createFile({
  key,
  filename,
  contentType,
  ownerId,
  tenantId,
}: NewFileRecord): Promise<FileRecord> {
  const [file] = await db
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
): Promise<FileRecord | null> {
  const conditions = [eq(files.id, id)];
  if (tenantId) {
    conditions.push(eq(files.tenantId, tenantId));
  }
  const [updated] = await db
    .update(files)
    .set({ status, size })
    .where(and(...conditions))
    .returning();
  return updated ?? null;
}

export async function findByOwnerId(ownerId: string, limit = 100): Promise<FileRecord[]> {
  return db
    .select()
    .from(files)
    .where(eq(files.ownerId, ownerId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function findAll(limit = 100): Promise<FileRecord[]> {
  return db.select().from(files).orderBy(desc(files.createdAt)).limit(limit);
}

export async function findByTenantId(tenantId: string, limit = 100): Promise<FileRecord[]> {
  return db
    .select()
    .from(files)
    .where(eq(files.tenantId, tenantId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function deleteById(id: string): Promise<void> {
  await db.delete(files).where(eq(files.id, id));
}
