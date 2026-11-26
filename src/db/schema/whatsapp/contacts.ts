import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';

// scope: tenant
export const whatsAppContacts = pgTable(
  'WhatsAppContact',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phoneNumber: text('phoneNumber').notNull(),
    waId: text('waId'),
    displayName: text('displayName'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppContact_tenant_phone_idx').on(table.tenantId, table.phoneNumber),
    index('WhatsAppContact_tenantId_idx').on(table.tenantId),
    index('WhatsAppContact_waId_idx').on(table.waId),
  ],
);

export type WhatsAppContactRecord = typeof whatsAppContacts.$inferSelect;
export type NewWhatsAppContactRecord = typeof whatsAppContacts.$inferInsert;
