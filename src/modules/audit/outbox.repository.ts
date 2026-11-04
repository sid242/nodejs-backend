import { asc, eq, sql } from 'drizzle-orm';

import { db, type DbExecutor } from '@/config/db';
import {
  outboxEvents,
  type NewOutboxEvent,
  type OutboxEvent,
} from '@/db/schema/index';

/**
 * Inserts an event into the transactional outbox table within the caller's transaction/executor.
 */
export async function insertOutboxEvent(
  event: NewOutboxEvent,
  executor: DbExecutor = db,
): Promise<OutboxEvent> {
  const [created] = await executor.insert(outboxEvents).values(event).returning();
  return created!;
}

/**
 * Fetches pending outbox events ready to be dispatched by the worker/relay.
 */
export async function fetchPendingOutboxEvents(
  limit = 50,
  executor: DbExecutor = db,
): Promise<OutboxEvent[]> {
  return executor
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.status, 'PENDING'))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit);
}

/**
 * Marks an outbox event as published.
 */
export async function markOutboxEventPublished(
  id: string,
  executor: DbExecutor = db,
): Promise<OutboxEvent | null> {
  const [updated] = await executor
    .update(outboxEvents)
    .set({
      status: 'PUBLISHED',
      processedAt: new Date(),
    })
    .where(eq(outboxEvents.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Records a delivery failure on an outbox event with retry count increment.
 */
export async function markOutboxEventFailed(
  id: string,
  error: string,
  executor: DbExecutor = db,
): Promise<OutboxEvent | null> {
  const [updated] = await executor
    .update(outboxEvents)
    .set({
      status: sql`CASE WHEN "retryCount" + 1 >= "maxRetries" THEN 'FAILED'::"OutboxStatus" ELSE 'PENDING'::"OutboxStatus" END`,
      retryCount: sql`"retryCount" + 1`,
      lastError: error,
    })
    .where(eq(outboxEvents.id, id))
    .returning();
  return updated ?? null;
}
