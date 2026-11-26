import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { whatsAppCampaignRecipientStatusEnum } from '../enums';
import { tenants } from '../tenancy/tenants';
import { whatsAppCampaigns } from './campaigns';
import { whatsAppContacts } from './contacts';
import { whatsAppMessages } from './messages';

// scope: tenant
export const whatsAppCampaignRecipients = pgTable(
  'WhatsAppCampaignRecipient',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaignId')
      .notNull()
      .references(() => whatsAppCampaigns.id, { onDelete: 'cascade' }),
    contactId: uuid('contactId')
      .notNull()
      .references(() => whatsAppContacts.id, { onDelete: 'cascade' }),
    messageId: uuid('messageId').references(() => whatsAppMessages.id, { onDelete: 'set null' }),
    status: whatsAppCampaignRecipientStatusEnum('status').notNull().default('PENDING'),
    errorCode: text('errorCode'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('WhatsAppCampaignRecipient_campaign_status_idx').on(table.campaignId, table.status),
    index('WhatsAppCampaignRecipient_tenantId_idx').on(table.tenantId),
    index('WhatsAppCampaignRecipient_contactId_idx').on(table.contactId),
  ],
);

export type WhatsAppCampaignRecipientRecord = typeof whatsAppCampaignRecipients.$inferSelect;
export type NewWhatsAppCampaignRecipientRecord = typeof whatsAppCampaignRecipients.$inferInsert;
