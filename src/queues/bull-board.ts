import type { Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { allQueues } from '@/queues/index.js';

export function bullBoardRouter(basePath = '/admin/queues'): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);
  createBullBoard({
    queues: allQueues.map((q) => new BullMQAdapter(q) as any),
    serverAdapter,
  });
  return serverAdapter.getRouter() as Router;
}
