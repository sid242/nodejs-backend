import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { whatsAppAccountStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';

// scope: tenant
export const whatsAppBusinessAccounts = pgTable(
  'WhatsAppBusinessAccount',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wabaId: text('wabaId').notNull(),
    businessId: text('businessId'),
    displayName: text('displayName').notNull(),
    encryptedAccessToken: text('encryptedAccessToken').notNull(),
    tokenKeyVersion: text('tokenKeyVersion').notNull().default('default'),
    tokenExpiresAt: timestamp('tokenExpiresAt', { precision: 3, mode: 'date' }),
    connectionStatus: whatsAppAccountStatusEnum('connectionStatus')
      .notNull()
      .default('NOT_CONNECTED'),
    connectedBy: uuid('connectedBy').references(() => users.id, { onDelete: 'set null' }),
    connectedAt: timestamp('connectedAt', { precision: 3, mode: 'date' }),
    disconnectedAt: timestamp('disconnectedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppBusinessAccount_tenant_waba_idx').on(table.tenantId, table.wabaId),
    index('WhatsAppBusinessAccount_tenantId_idx').on(table.tenantId),
    index('WhatsAppBusinessAccount_wabaId_idx').on(table.wabaId),
  ],
);

export type WhatsAppBusinessAccountRecord = typeof whatsAppBusinessAccounts.$inferSelect;
export type NewWhatsAppBusinessAccountRecord = typeof whatsAppBusinessAccounts.$inferInsert;
