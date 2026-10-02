import { eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { files } from '../../db/schema/index.js';
import { emitToUser } from '../../sockets/emitter.js';

export async function processFile(job) {
  const { fileId, ownerId } = job.data;
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) return { skipped: true };

  // TODO: real work goes here (thumbnails with sharp, virus scan, OCR, video transcode...).
  await job.updateProgress(100);

  // Push the result to the user's browser, regardless of which API node holds their socket.
  emitToUser(ownerId, 'file:processed', { fileId });
  return { ok: true };
}
