---
name: create-queue-worker
description: >-
  Use this skill when creating a new BullMQ background queue, worker processor, recurring cron scheduler,
  or integrating asynchronous job processing with WebSocket client notifications.
---

# Create BullMQ Queue & Worker Runbook

This guide details how to create and wire a new background worker and queue in the architecture using TypeScript and extensionless module paths.

---

## 1. Define the Queue

1. Open `src/queues/index.ts`.
2. Add the queue name to `QUEUES`:
   ```typescript
   export const QUEUES = {
     EMAIL: 'email',
     FILE: 'file-processing',
     MAINTENANCE: 'maintenance',
     REPORT: 'report-generation', // New queue
   } as const;
   ```
3. Instantiate and export the queue:
   ```typescript
   export const reportQueue = make(QUEUES.REPORT);
   export const allQueues = [emailQueue, fileQueue, maintenanceQueue, reportQueue];
   ```

---

## 2. Implement the Worker Processor

Create `src/queues/workers/report.worker.ts`:

```typescript
import type { Job } from 'bullmq';

import { logger } from '@/config/logger';
import { emitToUser } from '@/sockets/emitter';

interface ReportJobData {
  reportId: string;
  userId: string;
}

export async function processReport(job: Job<ReportJobData>) {
  const { reportId, userId } = job.data;
  logger.info({ reportId, userId }, 'processing report');

  // ... business logic (e.g. aggregate data, upload PDF to S3) ...

  // Push real-time completion event to connected client via Redis emitter
  emitToUser(userId, 'report:ready', {
    reportId,
    downloadUrl: `https://example.com/reports/${reportId}.pdf`,
  });
}
```

---

## 3. Register the Worker

1. Open `src/queues/workers/index.ts`.
2. Import `processReport` and register the worker:
   ```typescript
   import { processReport } from './report.worker';

   export function startWorkers() {
     return [
       createWorker(QUEUES.EMAIL, processEmail, {
         concurrency: env.EMAIL_WORKER_CONCURRENCY,
         limiter: { max: 50, duration: 1000 },
       }),
       createWorker(QUEUES.FILE, processFile, { concurrency: env.FILE_WORKER_CONCURRENCY }),
       createWorker(QUEUES.MAINTENANCE, processMaintenance, {
         concurrency: env.MAINTENANCE_WORKER_CONCURRENCY,
       }),
       createWorker(QUEUES.REPORT, processReport, { concurrency: 5 }), // New worker
     ];
   }
   ```

---

## 4. Register Recurring / Cron Schedulers (Optional)

If the worker job needs to run on a recurring cron pattern:

```typescript
export async function registerSchedulers() {
  await reportQueue.upsertJobScheduler(
    'generate-daily-summary',
    { pattern: '0 0 * * *' }, // Daily at midnight
    { name: 'daily-summary' },
  );
}
```

---

## 5. Produce Jobs from Services

From any API route or service:

```typescript
import { reportQueue } from '@/queues';

export async function requestReport(userId: string, options: Record<string, unknown>) {
  const job = await reportQueue.add(
    'generate',
    { userId, options, requestedAt: new Date().toISOString() },
    { jobId: `report:${userId}:${Date.now()}` }, // Deduplication / tracking key
  );
  return { jobId: job.id };
}
```

---

## 6. Run & Test Workers

Run the worker daemon in development:

```bash
npm run dev:worker
```

Monitor queue metrics and inspect failed jobs in the Bull-Board dashboard at `/admin/queues`.
