#!/usr/bin/env node
/**
 * Lightweight multi-process supervisor for single-container / free-tier deployments.
 * Spawns both the HTTP API server (dist/server.js) and the BullMQ worker (dist/worker.js).
 * Forwards termination signals (SIGTERM, SIGINT) and exits immediately if either child process dies.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const serverPath = path.join(rootDir, 'dist', 'server.js');
const workerPath = path.join(rootDir, 'dist', 'worker.js');

console.log('[supervisor] Starting server and worker processes...');

let isShuttingDown = false;

function launch(name, targetPath) {
  const child = spawn(process.execPath, [targetPath], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    console.error(`[supervisor] Failed to start ${name}:`, err);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (isShuttingDown) return;
    console.warn(`[supervisor] Process ${name} exited with code ${code ?? signal}. Terminating stack...`);
    shutdown(code ?? 1);
  });

  return child;
}

const server = launch('api-server', serverPath);
const worker = launch('queue-worker', workerPath);

function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('[supervisor] Shutting down children...');

  const killChild = (child, name) => {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch (err) {
        console.error(`[supervisor] Error killing ${name}:`, err);
      }
    }
  };

  killChild(server, 'api-server');
  killChild(worker, 'queue-worker');

  // Hard exit fallback after 10s if processes don't exit cleanly
  setTimeout(() => {
    console.warn('[supervisor] Force-terminating remaining processes (SIGKILL)...');
    try { server.kill('SIGKILL'); } catch {}
    try { worker.kill('SIGKILL'); } catch {}
    process.exit(exitCode);
  }, 10000).unref();
}

process.on('SIGTERM', () => {
  console.log('[supervisor] Received SIGTERM');
  shutdown(0);
});

process.on('SIGINT', () => {
  console.log('[supervisor] Received SIGINT');
  shutdown(0);
});
