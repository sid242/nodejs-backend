import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { whatsAppCampaignStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';
import { whatsAppTemplates } from './templates';

// scope: tenant
export const whatsAppCampaigns = pgTable(
  'WhatsAppCampaign',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    templateId: uuid('templateId')
      .notNull()
      .references(() => whatsAppTemplates.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phoneNumberId').notNull(),
    status: whatsAppCampaignStatusEnum('status').notNull().default('DRAFT'),
    scheduledAt: timestamp('scheduledAt', { precision: 3, mode: 'date' }),
    totalRecipients: integer('totalRecipients').notNull().default(0),
    acceptedCount: integer('acceptedCount').notNull().default(0),
    deliveredCount: integer('deliveredCount').notNull().default(0),
    readCount: integer('readCount').notNull().default(0),
    failedCount: integer('failedCount').notNull().default(0),
    createdBy: uuid('createdBy').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('WhatsAppCampaign_tenant_status_created_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    index('WhatsAppCampaign_tenantId_idx').on(table.tenantId),
  ],
);

export type WhatsAppCampaignRecord = typeof whatsAppCampaigns.$inferSelect;
export type NewWhatsAppCampaignRecord = typeof whatsAppCampaigns.$inferInsert;
