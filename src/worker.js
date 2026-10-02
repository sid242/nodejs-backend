import { logger } from './config/logger.js';
import { closeDb } from './config/db.js';
import { closeRedisClients } from './config/redis.js';
import { closeQueues } from './queues/index.js';
import { startWorkers, registerSchedulers } from './queues/workers/index.js';
import { closeSocketEmitter } from './sockets/emitter.js';

// Separate process from the API => scale and deploy independently (e.g. autoscale on queue depth).
const workers = startWorkers();
await registerSchedulers();
logger.info({ queues: workers.map((w) => w.name) }, 'workers started');

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'worker shutdown: finishing in-flight jobs');
  const force = setTimeout(() => process.exit(1), 55_000);
  force.unref();
  try {
    await Promise.all(workers.map((w) => w.close())); // waits for active jobs to finish
    await closeSocketEmitter();
    await closeQueues();
    await closeDb();
    await closeRedisClients();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
