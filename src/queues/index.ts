import { Queue, type DefaultJobOptions } from 'bullmq';
import { createRedis } from '@/config/redis.js';
import { env } from '@/config/env.js';

export const QUEUES = {
  EMAIL: 'email',
  FILE: 'file-processing',
  MAINTENANCE: 'maintenance',
} as const;

// Producer connection (used by the API and the worker when it enqueues follow-up jobs).
export const queueConnection = createRedis('queue-producer', {
  forBull: true,
  url: env.QUEUE_REDIS_URL,
});

// Sensible defaults: retry with exponential backoff, and don't let Redis fill up with old jobs.
const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  // Bound both age and count: an outage must not consume Redis indefinitely.
  removeOnFail: { age: 7 * 24 * 3600, count: 10_000 },
};

const make = (name: string): Queue =>
  new Queue(name, { connection: queueConnection, defaultJobOptions });

export const emailQueue = make(QUEUES.EMAIL);
export const fileQueue = make(QUEUES.FILE);
export const maintenanceQueue = make(QUEUES.MAINTENANCE);
export const allQueues: Queue[] = [emailQueue, fileQueue, maintenanceQueue];

export async function closeQueues(): Promise<void> {
  await Promise.all(allQueues.map((q) => q.close()));
  await queueConnection.quit();
}
