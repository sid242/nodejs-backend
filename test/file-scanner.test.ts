import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';

import { env } from '@/config/env';
import { scanFileBytes } from '@/modules/files/file-scanner';

test('file scanner sends complete bytes and distinguishes verdicts from errors', async (t) => {
  const bytes = Buffer.from('local file fixture');
  const command = Buffer.from('zINSTREAM\0');
  const frameLength = command.length + 4 + bytes.length + 4;
  let verdict = 'stream: OK\0';
  let requests = 0;

  const server = createServer((socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
      if (received.length < frameLength) return;
      requests++;
      assert.equal(received.length, frameLength);
      assert.deepEqual(received.subarray(0, command.length), command);
      assert.equal(received.readUInt32BE(command.length), bytes.length);
      assert.deepEqual(received.subarray(command.length + 4, -4), bytes);
      assert.equal(received.readUInt32BE(frameLength - 4), 0);
      socket.end(verdict);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const previousHost = env.CLAMD_HOST;
  const previousPort = env.CLAMD_PORT;
  env.CLAMD_HOST = '127.0.0.1';
  env.CLAMD_PORT = address.port;
  t.after(() => {
    env.CLAMD_HOST = previousHost;
    env.CLAMD_PORT = previousPort;
  });

  assert.equal(await scanFileBytes(bytes), 'CLEAN');
  verdict = 'stream: Fixture FOUND\0';
  assert.equal(await scanFileBytes(bytes), 'INFECTED');
  verdict = 'stream: internal ERROR\0';
  await assert.rejects(scanFileBytes(bytes), /valid verdict/);
  assert.equal(requests, 3);
});
