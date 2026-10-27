# BullMQ Queues & Worker Rules

## 1. Queue Architecture

- All asynchronous jobs (emails, image/file processing, cleanup, webhooks) must be pushed to BullMQ queues.
- Queues are instantiated in `src/queues/index.ts` using `queueConnection`.
- Workers are run in the separate worker process (`src/worker.ts`) via `src/queues/workers/index.ts`.

## 2. Idempotency & Job Options

- Jobs can and will be retried upon worker restarts or unexpected failures.
- Always implement processors to be **idempotent** (re-running the same job multiple times produces the same outcome without duplication or corruption).
- Use deterministic `jobId` for deduplication when appropriate:
  ```typescript
  await emailQueue.add('welcome-email', { userId, email }, { jobId: `welcome:${userId}` });
  ```

## 3. Worker Implementation Pattern

- Processors are isolated in `src/queues/workers/<domain>.worker.ts`:
  ```typescript
  import type { Job } from 'bullmq';

  export async function processEmail(job: Job) {
    const { to, subject, html } = job.data;
    await sendEmail({ to, subject, html });
  }
  ```
- Workers are initialized in `src/queues/workers/index.ts`:
  ```typescript
  createWorker(QUEUES.EMAIL, processEmail, {
    concurrency: env.EMAIL_WORKER_CONCURRENCY,
    limiter: { max: 50, duration: 1000 }, // SES / API rate-friendly
  });
  ```

## 4. Real-time Worker-to-Client Communication

- When a worker finishes a background job and needs to notify the client, use the Redis Socket Emitter (`src/sockets/emitter.ts`):
  ```typescript
  import { emitToUser } from '@/sockets/emitter';

  export async function processFile(job: Job) {
    const { fileId, userId } = job.data;
    // ... file processing logic ...
    emitToUser(userId, 'file:processed', { fileId, status: 'READY' });
  }
  ```

## 5. Cron & Scheduled Jobs

- Scheduled jobs must be registered in `registerSchedulers()` using `upsertJobScheduler()`:
  ```javascript
  export async function registerSchedulers() {
    await maintenanceQueue.upsertJobScheduler(
      'cleanup-pending-files',
      { pattern: '0 * * * *' }, // every hour
      { name: 'cleanup-pending-files' },
    );
  }
  ```
- BullMQ's `upsertJobScheduler` ensures only one instance runs even when multiple worker replicas exist.
