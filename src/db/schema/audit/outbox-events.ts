import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { outboxStatusEnum } from '../enums';
import { tenants } from '../tenancy/tenants';

export const outboxEvents = pgTable(
  'OutboxEvent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('eventType').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    retryCount: integer('retryCount').notNull().default(0),
    maxRetries: integer('maxRetries').notNull().default(5),
    lastError: text('lastError'),
    processedAt: timestamp('processedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('OutboxEvent_status_createdAt_idx').on(table.status, table.createdAt),
    index('OutboxEvent_tenantId_status_idx').on(table.tenantId, table.status),
    index('OutboxEvent_eventType_idx').on(table.eventType),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

