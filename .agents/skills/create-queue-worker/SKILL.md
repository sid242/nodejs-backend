---
name: create-queue-worker
description: >-
  Use this skill when creating a new BullMQ background queue, worker processor, recurring cron scheduler,
  or integrating asynchronous job processing with WebSocket client notifications.
---

# Create BullMQ Queue & Worker Runbook

This guide details how to create and wire a new background worker and queue in the architecture.

---

## 1. Define the Queue

1. Open `src/queues/index.js`.
2. Add the queue name to `QUEUES`:
   ```javascript
   export const QUEUES = {
     EMAIL: 'email',
     FILE: 'file-processing',
     MAINTENANCE: 'maintenance',
     REPORT: 'report-generation', // New queue
   };
   ```
3. Instantiate and export the queue:
   ```javascript
   export const reportQueue = make(QUEUES.REPORT);
   export const allQueues = [emailQueue, fileQueue, maintenanceQueue, reportQueue];
   ```

---

## 2. Implement the Worker Processor

Create `src/queues/workers/report.worker.js`:

```javascript
import { logger } from '../../config/logger.js';
import { emitToUser } from '../../sockets/emitter.js';

export async function processReport(job) {
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

1. Open `src/queues/workers/index.js`.
2. Import `processReport` and register the worker:
   ```javascript
   import { processReport } from './report.worker.js';

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

```javascript
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

```javascript
import { reportQueue } from '../../queues/index.js';

export async function requestReport(userId, options) {
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
