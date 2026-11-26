import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { whatsAppAccountStatusEnum } from '../enums';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const platformWhatsAppAccountRegistry = pgTable(
  'PlatformWhatsAppAccountRegistry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wabaId: text('wabaId').notNull(),
    phoneNumberId: text('phoneNumberId').notNull(),
    databaseRoutingKey: text('databaseRoutingKey'),
    connectionStatus: whatsAppAccountStatusEnum('connectionStatus').notNull().default('CONNECTED'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('PlatformWhatsApp_phoneNumberId_idx').on(table.phoneNumberId),
    uniqueIndex('PlatformWhatsApp_tenant_waba_phone_idx').on(
      table.tenantId,
      table.wabaId,
      table.phoneNumberId,
    ),
    index('PlatformWhatsApp_tenantId_idx').on(table.tenantId),
    index('PlatformWhatsApp_wabaId_idx').on(table.wabaId),
  ],
);

export type PlatformWhatsAppAccountRegistryRecord =
  typeof platformWhatsAppAccountRegistry.$inferSelect;
export type NewPlatformWhatsAppAccountRegistryRecord =
  typeof platformWhatsAppAccountRegistry.$inferInsert;
