import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { whatsAppMessages } from './messages';

// scope: tenant
export const whatsAppMessageAttachments = pgTable(
  'WhatsAppMessageAttachment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    messageId: uuid('messageId')
      .notNull()
      .references(() => whatsAppMessages.id, { onDelete: 'cascade' }),
    storageKey: text('storageKey').notNull(),
    providerMediaId: text('providerMediaId'),
    mimeType: text('mimeType').notNull(),
    filename: text('filename').notNull(),
    sizeBytes: bigint('sizeBytes', { mode: 'number' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('WhatsAppAttachment_messageId_idx').on(table.messageId),
    index('WhatsAppAttachment_tenantId_idx').on(table.tenantId),
    index('WhatsAppAttachment_providerMediaId_idx').on(table.providerMediaId),
  ],
);

export type WhatsAppMessageAttachmentRecord = typeof whatsAppMessageAttachments.$inferSelect;
export type NewWhatsAppMessageAttachmentRecord = typeof whatsAppMessageAttachments.$inferInsert;
