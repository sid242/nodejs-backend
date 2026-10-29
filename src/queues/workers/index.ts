import { Worker, type Processor, type WorkerOptions } from 'bullmq';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedis } from '@/config/redis';
import { maintenanceQueue, QUEUES } from '@/queues/index';
import { processEmail } from '@/queues/workers/email.worker';
import { processFile } from '@/queues/workers/file.worker';
import { processMaintenance } from '@/queues/workers/maintenance.worker';

function createWorker(
  name: string,
  processor: Processor,
  opts: Partial<WorkerOptions> = {},
): Worker {
  const worker = new Worker(name, processor, {
    connection: createRedis(`worker-${name}`, { forBull: true, url: env.QUEUE_REDIS_URL }),
    concurrency: env.WORKER_CONCURRENCY,
    ...opts,
  });
  worker.on('completed', (job) =>
    logger.info({ queue: name, jobId: job.id, job: job.name }, 'job completed'),
  );
  worker.on('failed', (job, err) => {
    const isExhausted = job ? job.attemptsMade >= (job.opts?.attempts || 1) : false;
    logger.error(
      {
        err,
        queue: name,
        jobId: job?.id,
        job: job?.name,
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts?.attempts,
        isExhausted,
      },
      isExhausted
        ? `[ALERT] Job permanently failed in queue "${name}" (exhausted all attempts)`
        : 'Job attempt failed',
    );
  });
  worker.on('error', (err) => logger.error({ err, queue: name }, 'worker error'));
  return worker;
}

export function startWorkers(): Worker[] {
  return [
    createWorker(QUEUES.EMAIL, processEmail, {
      concurrency: env.EMAIL_WORKER_CONCURRENCY,
      limiter: { max: 50, duration: 1000 }, // SES send-rate friendly
    }),
    createWorker(QUEUES.FILE, processFile as Processor, {
      concurrency: env.FILE_WORKER_CONCURRENCY,
    }),
    createWorker(QUEUES.MAINTENANCE, processMaintenance, {
      concurrency: env.MAINTENANCE_WORKER_CONCURRENCY,
    }),
  ];
}

/** Cron-style jobs. upsert is idempotent, so it's safe when many worker replicas boot. */
export async function registerSchedulers(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    'cleanup-pending-files',
    { pattern: '0 * * * *' }, // hourly
    { name: 'cleanup-pending-files' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'expire-support-sessions',
    { pattern: '* * * * *' }, // every minute
    { name: 'expire-support-sessions' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'expire-trialing-subscriptions',
    { pattern: '0 * * * *' }, // hourly
    { name: 'expire-trialing-subscriptions' },
  );
}
