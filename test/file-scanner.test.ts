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

test('file scanner requires ClamAV daemon unless ALLOW_UNSCANNED_FILES is explicitly true', async (t) => {
  const bytes = Buffer.from('test data');
  const prevHost = env.CLAMD_HOST;
  const prevPort = env.CLAMD_PORT;
  const prevAllow = env.ALLOW_UNSCANNED_FILES;

  t.after(() => {
    env.CLAMD_HOST = prevHost;
    env.CLAMD_PORT = prevPort;
    (env as { ALLOW_UNSCANNED_FILES: boolean }).ALLOW_UNSCANNED_FILES = prevAllow;
  });

  // 1. Without ALLOW_UNSCANNED_FILES, missing CLAMD_HOST throws
  (env as { ALLOW_UNSCANNED_FILES: boolean }).ALLOW_UNSCANNED_FILES = false;
  env.CLAMD_HOST = undefined;
  await assert.rejects(scanFileBytes(bytes), /A ClamAV daemon is required to scan files/);

  // 2. Without ALLOW_UNSCANNED_FILES, unreachable CLAMD_HOST rejects with ECONNREFUSED
  env.CLAMD_HOST = '127.0.0.1';
  env.CLAMD_PORT = 1; // reserved port, unreachable
  await assert.rejects(scanFileBytes(bytes), (err: any) => err.code === 'ECONNREFUSED');

  // 3. With explicit ALLOW_UNSCANNED_FILES=true, missing CLAMD_HOST auto-marks as CLEAN
  (env as { ALLOW_UNSCANNED_FILES: boolean }).ALLOW_UNSCANNED_FILES = true;
  env.CLAMD_HOST = undefined;
  assert.equal(await scanFileBytes(bytes), 'CLEAN');

  // 4. With explicit ALLOW_UNSCANNED_FILES=true, unreachable CLAMD_HOST auto-marks as CLEAN
  env.CLAMD_HOST = '127.0.0.1';
  env.CLAMD_PORT = 1;
  assert.equal(await scanFileBytes(bytes), 'CLEAN');
});

test('production config rejects ALLOW_UNSCANNED_FILES=true', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  await assert.rejects(
    execFileAsync(process.execPath, ['--import', 'tsx', '-e', "import('./src/config/env')"], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ALLOW_UNSCANNED_FILES: 'true',
        APP_BASE_DOMAIN: 'example.com',
        ENCRYPTION_KEY: '12345678901234567890123456789012',
        BFF_SHARED_SECRET: 'production-bff-secret-key-min-16-chars',
        INTERNAL_API_SECRET: 'production-internal-secret-min-32-chars-long-example',
      },
      cwd: process.cwd(),
    }),
    (err: any) => {
      const stderr = err.stderr || err.stdout || '';
      return stderr.includes('ALLOW_UNSCANNED_FILES is strictly forbidden in production');
    },
  );
});
