import { closeDb } from '@/config/db';
import { logger } from '@/config/logger';
import { closeRedisClients } from '@/config/redis';
import { drainDedicatedPools } from '@/lib/db-manager';
import { initSentry } from '@/observability/sentry';
import { closeQueues } from '@/queues/index';
import { registerSchedulers, startWorkers } from '@/queues/workers/index';
import { closeSocketEmitter } from '@/sockets/emitter';

initSentry();

// Separate process from the API => scale and deploy independently (e.g. autoscale on queue depth).
const workers = startWorkers();
await registerSchedulers();
logger.info({ queues: workers.map((w) => w.name) }, 'workers started');

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'worker shutdown: finishing in-flight jobs');
  const force = setTimeout(() => process.exit(1), 55_000);
  force.unref();
  try {
    await Promise.all(workers.map((w) => w.close())); // waits for active jobs to finish
    await closeSocketEmitter();
    await closeQueues();
    await drainDedicatedPools();
    await closeDb();
    await closeRedisClients();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
