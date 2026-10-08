import { Router, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { redis } from '@/config/redis.js';
import { queueConnection } from '@/queues/index.js';
import { state } from '@/lib/state.js';

const router = Router();

// Liveness: "is the process up?" (restart if not). No dependency checks here.
router.get('/live', (_req: Request, res: Response) => res.json({ status: 'ok' }));

// Readiness: "should the load balancer send traffic?" Flips to 503 during graceful shutdown.
router.get('/ready', async (_req: Request, res: Response) => {
  if (state.shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  const [database, stateRedis, queueRedis] = await Promise.allSettled([
    db.execute(sql`SELECT 1`),
    redis.ping(),
    queueConnection.ping(),
  ]);
  const ok =
    database.status === 'fulfilled' &&
    stateRedis.status === 'fulfilled' &&
    queueRedis.status === 'fulfilled';
  return res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db: database.status,
    redis: stateRedis.status,
    queue: queueRedis.status,
  });
});

export default router;
