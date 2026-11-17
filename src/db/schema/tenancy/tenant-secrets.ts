import { relations } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants';

/**
 * Encrypted Tenant Secrets Store (dev/small installs or fallback driver).
 * Stores encrypted database credentials, API keys, and sensitive tokens.
 */
// scope: primary
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    keyId: text('key_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('tenant_secrets_tenant_name_unique').on(table.tenantId, table.name),
  ],
);

export const tenantSecretsRelations = relations(tenantSecrets, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSecrets.tenantId],
    references: [tenants.id],
  }),
}));

export type TenantSecret = typeof tenantSecrets.$inferSelect;
export type NewTenantSecret = typeof tenantSecrets.$inferInsert;
