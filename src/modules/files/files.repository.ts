import { desc, eq } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { files, type FileRecord, type NewFileRecord } from '@/db/schema/index.js';

export async function findById(id: string): Promise<FileRecord | null> {
  const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return file ?? null;
}

export async function createFile({
  key,
  filename,
  contentType,
  ownerId,
}: NewFileRecord): Promise<FileRecord> {
  const [file] = await db.insert(files).values({ key, filename, contentType, ownerId }).returning();
  return file as FileRecord;
}

export interface UpdateStatusAndSizeOptions {
  status: 'PENDING' | 'UPLOADED';
  size?: number | null;
}

export async function updateStatusAndSize(
  id: string,
  { status, size }: UpdateStatusAndSizeOptions,
): Promise<FileRecord | null> {
  const [updated] = await db
    .update(files)
    .set({ status, size })
    .where(eq(files.id, id))
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

export async function deleteById(id: string): Promise<void> {
  await db.delete(files).where(eq(files.id, id));
}
