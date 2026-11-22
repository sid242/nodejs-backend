import { createConnection } from 'node:net';

import { env } from '@/config/env';

export async function scanFileBytes(bytes: Uint8Array): Promise<'CLEAN' | 'INFECTED'> {
  if (!env.CLAMD_HOST) throw new Error('A ClamAV daemon is required to scan files');

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.CLAMD_HOST, port: env.CLAMD_PORT });
    const timer = setTimeout(() => socket.destroy(new Error('File scan timed out')), 30_000);
    let reply = '';

    socket.on('error', reject);
    socket.once('close', () => {
      clearTimeout(timer);
      reject(new Error('Scanner closed before returning a verdict'));
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      reply += chunk;
      if (reply.length > 2048) {
        socket.destroy(new Error('Unexpected scanner response size'));
        return;
      }
      const separator = reply.indexOf('\0');
      if (separator < 0) return;
      const verdict = reply.slice(0, separator);
      if (verdict === 'stream: OK') resolve('CLEAN');
      else if (verdict.startsWith('stream: ') && verdict.endsWith(' FOUND')) resolve('INFECTED');
      else reject(new Error('Scanner did not return a valid verdict'));
      socket.destroy();
    });

    socket.once('connect', () => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.byteLength);
      socket.write('zINSTREAM\0');
      socket.write(length);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
  });
}
