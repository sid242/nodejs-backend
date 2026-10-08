import { desc, eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { files } from '../../db/schema/index.js';

export async function findById(id) {
  const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return file ?? null;
}

export async function createFile({ key, filename, contentType, ownerId }) {
  const [file] = await db.insert(files).values({ key, filename, contentType, ownerId }).returning();
  return file;
}

export async function updateStatusAndSize(id, { status, size }) {
  const [updated] = await db
    .update(files)
    .set({ status, size })
    .where(eq(files.id, id))
    .returning();
  return updated ?? null;
}

export async function findByOwnerId(ownerId, limit = 100) {
  return db
    .select()
    .from(files)
    .where(eq(files.ownerId, ownerId))
    .orderBy(desc(files.createdAt))
    .limit(limit);
}

export async function deleteById(id) {
  return db.delete(files).where(eq(files.id, id));
}
