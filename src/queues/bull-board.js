import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { allQueues } from './index.js';

export function bullBoardRouter(basePath = '/admin/queues') {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);
  createBullBoard({ queues: allQueues.map((q) => new BullMQAdapter(q)), serverAdapter });
  return serverAdapter.getRouter();
}
