import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { whatsAppBusinessAccounts } from './accounts';

// scope: tenant
export const whatsAppPhoneNumbers = pgTable(
  'WhatsAppPhoneNumber',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    businessAccountId: uuid('businessAccountId')
      .notNull()
      .references(() => whatsAppBusinessAccounts.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phoneNumberId').notNull(),
    displayPhoneNumber: text('displayPhoneNumber').notNull(),
    verifiedName: text('verifiedName'),
    qualityRating: text('qualityRating'),
    messagingLimit: text('messagingLimit'),
    isDefault: boolean('isDefault').notNull().default(false),
    isEnabled: boolean('isEnabled').notNull().default(true),
    registrationStatus: text('registrationStatus').notNull().default('CONNECTED'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppPhoneNumber_tenant_phoneId_idx').on(table.tenantId, table.phoneNumberId),
    index('WhatsAppPhoneNumber_tenantId_idx').on(table.tenantId),
    index('WhatsAppPhoneNumber_businessAccountId_idx').on(table.businessAccountId),
    index('WhatsAppPhoneNumber_phoneNumberId_idx').on(table.phoneNumberId),
  ],
);

export type WhatsAppPhoneNumberRecord = typeof whatsAppPhoneNumbers.$inferSelect;
export type NewWhatsAppPhoneNumberRecord = typeof whatsAppPhoneNumbers.$inferInsert;
