import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { whatsAppScheduledMessageStatusEnum } from '../enums';
import { tenants } from '../tenancy/tenants';
import { whatsAppMessages } from './messages';

// scope: tenant
export const whatsAppScheduledMessages = pgTable(
  'WhatsAppScheduledMessage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: uuid('messageId')
      .notNull()
      .references(() => whatsAppMessages.id, { onDelete: 'cascade' }),
    scheduledAt: timestamp('scheduledAt', { precision: 3, mode: 'date' }).notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    status: whatsAppScheduledMessageStatusEnum('status').notNull().default('SCHEDULED'),
    queueJobId: text('queueJobId'),
    cancelledAt: timestamp('cancelledAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('WhatsAppScheduled_tenant_status_sched_idx').on(
      table.tenantId,
      table.status,
      table.scheduledAt,
    ),
    index('WhatsAppScheduled_messageId_idx').on(table.messageId),
  ],
);

export type WhatsAppScheduledMessageRecord = typeof whatsAppScheduledMessages.$inferSelect;
export type NewWhatsAppScheduledMessageRecord = typeof whatsAppScheduledMessages.$inferInsert;
