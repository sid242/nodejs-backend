import * as fileRepo from '../../modules/files/files.repository.js';
import { emitToUser } from '../../sockets/emitter.js';

export async function processFile(job) {
  const { fileId, ownerId } = job.data;
  const file = await fileRepo.findById(fileId);
  if (!file) return { skipped: true };

  // TODO: real work goes here (thumbnails with sharp, virus scan, OCR, video transcode...).
  await job.updateProgress(100);

  // Push the result to the user's browser, regardless of which API node holds their socket.
  emitToUser(ownerId, 'file:processed', { fileId });
  return { ok: true };
}
