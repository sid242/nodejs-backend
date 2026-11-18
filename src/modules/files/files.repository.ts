import { and, desc, eq } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import { assertTenantScope, tenantDb } from '@/db/tenancy/context';
import { files, type FileRecord, type NewFileRecord } from '@/db/schema/index';

export async function findById(
  id: string,
  tenantId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord | null> {
  assertTenantScope(tenantId);
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
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord> {
  assertTenantScope(tenantId);
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
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord | null> {
  assertTenantScope(tenantId);
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
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord[]> {
  return executor
    .select()
    .from(files)
    .where(eq(files.ownerId, ownerId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function findAll(
  limit = 100,
  executor: DbExecutor = tenantDb(),
): Promise<FileRecord[]> {
  return executor.select().from(files).orderBy(desc(files.createdAt)).limit(limit);
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
    .where(eq(files.tenantId, tenantId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
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
