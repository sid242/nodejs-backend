import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { files } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { safeFilename } from '../../lib/utils.js';
import { createUploadPost, createDownloadUrl, headObject, deleteObject } from '../../lib/s3.js';
import { fileQueue } from '../../queues/index.js';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

async function getOwned(userId, id) {
  const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  // 404 (not 403) so we don't leak the existence of other users' files.
  if (!file || file.ownerId !== userId) throw AppError.notFound('File not found');
  return file;
}

/** Step 1: client asks for permission to upload -> gets a short-lived presigned POST. */
export async function requestUpload(userId, { filename, contentType }) {
  const key = `uploads/${userId}/${randomUUID()}-${safeFilename(filename)}`;
  const [file] = await db
    .insert(files)
    .values({ key, filename, contentType, ownerId: userId })
    .returning();
  const upload = await createUploadPost({ key, contentType });
  return { fileId: file.id, upload }; // client POSTs { ...upload.fields, file } to upload.url
}

/** Step 3: after the browser finished uploading to S3, verify the object exists and kick off processing. */
export async function confirmUpload(userId, id) {
  const file = await getOwned(userId, id);
  if (file.status === 'UPLOADED') return file;

  const head = await headObject(file.key).catch(() => null);
  if (!head) throw AppError.badRequest('Upload not found in storage yet');

  const [updated] = await db
    .update(files)
    .set({ status: 'UPLOADED', size: head.ContentLength })
    .where(eq(files.id, id))
    .returning();
  await fileQueue.add('process', { fileId: id, ownerId: userId }, { jobId: `process-${id}` });
  return updated;
}

export async function getDownloadUrl(userId, id) {
  const file = await getOwned(userId, id);
  if (file.status !== 'UPLOADED') throw AppError.badRequest('File not uploaded yet');
  return { url: await createDownloadUrl(file.key), expiresInSeconds: 300 };
}

export const listFiles = (userId) =>
  db
    .select()
    .from(files)
    .where(eq(files.ownerId, userId))
    .orderBy(desc(files.createdAt))
    .limit(100);

export async function deleteFile(userId, id) {
  const file = await getOwned(userId, id);
  await deleteObject(file.key);
  await db.delete(files).where(eq(files.id, id));
}
