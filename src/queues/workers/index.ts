import { Worker, type Processor, type WorkerOptions } from 'bullmq';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { createRedis } from '@/config/redis';
import { captureJobException } from '@/observability/sentry';
import { maintenanceQueue, notificationQueue, QUEUES } from '@/queues/index';
import { processDbOperation } from '@/queues/workers/db-ops.worker';
import { processEmail } from '@/queues/workers/email.worker';
import { processFile } from '@/queues/workers/file.worker';
import { processMaintenance } from '@/queues/workers/maintenance.worker';
import { processMemberImport } from '@/queues/workers/member-import.worker';
import { processNotification } from '@/queues/workers/notification.worker';
import { processWebhookDelivery } from '@/queues/workers/webhook.worker';

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
    if (job) {
      captureJobException(err, {
        id: job.id,
        name: job.name,
        data: name === QUEUES.MEMBER_IMPORT ? { tenantId: job.data.tenantId } : job.data,
        queueName: name,
      });
    }
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
    createWorker(QUEUES.DB_OPS, processDbOperation as Processor, {
      concurrency: 2,
    }),
    createWorker(QUEUES.NOTIFICATION, processNotification as Processor, {
      concurrency: 5,
    }),
    createWorker(QUEUES.MEMBER_IMPORT, processMemberImport as Processor, { concurrency: 2 }),
    createWorker(QUEUES.WEBHOOK, processWebhookDelivery as Processor, {
      concurrency: 5,
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
    'cleanup-stale-db-operations',
    { pattern: '*/15 * * * *' }, // every 15 minutes
    { name: 'cleanup-stale-db-operations' },
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

  await maintenanceQueue.upsertJobScheduler(
    'billing-dunning-daily',
    { pattern: '0 5 * * *' }, // daily at 05:00 UTC
    { name: 'billing-dunning' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'domain-reverify-weekly',
    { pattern: '0 3 * * 0' }, // weekly Sunday at 03:00
    { name: 'domain-reverify' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'process-outbox-events-interval',
    { pattern: '*/1 * * * *' }, // every minute
    { name: 'process-outbox-events' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'audit-retention-purge-daily',
    { pattern: '0 2 * * *' }, // daily at 02:00 UTC
    { name: 'audit-retention-purge' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'verify-audit-chains-nightly',
    { pattern: '0 3 * * *' }, // nightly at 03:00 UTC
    { name: 'verify-audit-chains' },
  );

  await notificationQueue.upsertJobScheduler(
    'cleanup-notifications-daily',
    { pattern: '0 4 * * *' }, // daily at 04:00 UTC
    { name: 'cleanup-notifications' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'retention-sweep-daily',
    { pattern: '30 2 * * *' }, // daily at 02:30 UTC
    { name: 'retention-sweep' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'process-account-deletions-daily',
    { pattern: '30 3 * * *' }, // daily at 03:30 UTC
    { name: 'process-account-deletions' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'process-tenant-purges-daily',
    { pattern: '30 4 * * *' }, // daily at 04:30 UTC
    { name: 'process-tenant-purges' },
  );

  await maintenanceQueue.upsertJobScheduler(
    'aggregate-platform-metrics-daily',
    { pattern: '0 1 * * *' }, // daily at 01:00 UTC
    { name: 'aggregate-platform-metrics' },
  );
}
