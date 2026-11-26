import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';

// scope: tenant
export const whatsAppUsageRecords = pgTable(
  'WhatsAppUsageRecord',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wabaId: text('wabaId').notNull(),
    phoneNumberId: text('phoneNumberId').notNull(),
    recipientCountry: text('recipientCountry').notNull().default('IN'),
    templateCategory: text('templateCategory').notNull(),
    providerMessageId: text('providerMessageId'),
    deliveryStatus: text('deliveryStatus').notNull().default('QUEUED'),
    messageTimestamp: timestamp('messageTimestamp', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    pricingRateCardVersion: text('pricingRateCardVersion').notNull().default('2025-07'),
    estimatedCost: numeric('estimatedCost', { precision: 10, scale: 4 })
      .notNull()
      .default('0.0000'),
    actualCost: numeric('actualCost', { precision: 10, scale: 4 }),
    currency: text('currency').notNull().default('INR'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('WhatsAppUsage_tenant_timestamp_idx').on(table.tenantId, table.messageTimestamp),
    index('WhatsAppUsage_providerMessageId_idx').on(table.providerMessageId),
    index('WhatsAppUsage_tenant_category_idx').on(table.tenantId, table.templateCategory),
  ],
);

export type WhatsAppUsageRecord = typeof whatsAppUsageRecords.$inferSelect;
export type NewWhatsAppUsageRecord = typeof whatsAppUsageRecords.$inferInsert;
