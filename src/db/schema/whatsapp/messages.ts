import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  whatsAppMessageDirectionEnum,
  whatsAppMessageInternalStatusEnum,
  whatsAppMessageTypeEnum,
} from '../enums';
import { tenants } from '../tenancy/tenants';
import { whatsAppContacts } from './contacts';
import { whatsAppConversations } from './conversations';
import { whatsAppTemplates } from './templates';

// scope: tenant
export const whatsAppMessages = pgTable(
  'WhatsAppMessage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phoneNumberId').notNull(),
    contactId: uuid('contactId')
      .notNull()
      .references(() => whatsAppContacts.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversationId').references(() => whatsAppConversations.id, {
      onDelete: 'set null',
    }),
    direction: whatsAppMessageDirectionEnum('direction').notNull(),
    messageType: whatsAppMessageTypeEnum('messageType').notNull(),
    templateId: uuid('templateId').references(() => whatsAppTemplates.id, {
      onDelete: 'set null',
    }),
    providerMessageId: text('providerMessageId'),
    idempotencyKey: text('idempotencyKey'),
    body: text('body'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    providerStatus: text('providerStatus'),
    internalStatus: whatsAppMessageInternalStatusEnum('internalStatus').notNull().default('QUEUED'),
    errorCode: text('errorCode'),
    errorMessage: text('errorMessage'),
    scheduledAt: timestamp('scheduledAt', { precision: 3, mode: 'date' }),
    acceptedAt: timestamp('acceptedAt', { precision: 3, mode: 'date' }),
    sentAt: timestamp('sentAt', { precision: 3, mode: 'date' }),
    deliveredAt: timestamp('deliveredAt', { precision: 3, mode: 'date' }),
    readAt: timestamp('readAt', { precision: 3, mode: 'date' }),
    failedAt: timestamp('failedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppMessage_tenant_idempotency_idx')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`"idempotencyKey" IS NOT NULL`),
    index('WhatsAppMessage_providerMessageId_idx').on(table.providerMessageId),
    index('WhatsAppMessage_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('WhatsAppMessage_tenant_contact_created_idx').on(
      table.tenantId,
      table.contactId,
      table.createdAt,
    ),
    index('WhatsAppMessage_tenant_conversation_created_idx').on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
    ),
    index('WhatsAppMessage_tenant_status_created_idx').on(
      table.tenantId,
      table.internalStatus,
      table.createdAt,
    ),
  ],
);

export type WhatsAppMessageRecord = typeof whatsAppMessages.$inferSelect;
export type NewWhatsAppMessageRecord = typeof whatsAppMessages.$inferInsert;
