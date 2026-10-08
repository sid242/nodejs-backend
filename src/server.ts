import http from 'node:http';
import { createApp } from '@/app.js';
import { env } from '@/config/env.js';
import { logger } from '@/config/logger.js';
import { closeDb } from '@/config/db.js';
import { closeRedisClients } from '@/config/redis.js';
import { state } from '@/lib/state.js';
import { closeQueues } from '@/queues/index.js';
import { initSocket } from '@/sockets/index.js';

const server = http.createServer(createApp());
const sockets = initSocket(server);

// Keep-alive must exceed the load balancer's idle timeout (ALB default 60s) to avoid sporadic 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;

server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening'));

async function shutdown(signal: string): Promise<void> {
  if (state.shuttingDown) return;
  state.shuttingDown = true; // /health/ready now returns 503 so the LB stops sending traffic
  logger.info({ signal }, 'graceful shutdown started');

  const force = setTimeout(() => {
    logger.error('forced exit after timeout');
    process.exit(1);
  }, 25_000);
  force.unref();

  try {
    await new Promise((resolve) => setTimeout(resolve, 5_000)); // let LB deregister this target
    await sockets.close(); // closes sockets, HTTP server, and Redis adapter clients
    await closeQueues();
    await closeDb();
    await closeRedisClients();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1); // state is unknown: let the orchestrator restart us
});
