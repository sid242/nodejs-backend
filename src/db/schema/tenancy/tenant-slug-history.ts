import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants';

// scope: primary
export const tenantSlugHistory = pgTable(
  'TenantSlugHistory',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    oldSlug: text('oldSlug').notNull(),
    changedAt: timestamp('changedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('TenantSlugHistory_oldSlug_idx').on(table.oldSlug),
    index('TenantSlugHistory_tenantId_idx').on(table.tenantId),
    index('TenantSlugHistory_expiresAt_idx').on(table.expiresAt),
  ],
);

export type TenantSlugHistoryRecord = typeof tenantSlugHistory.$inferSelect;
export type NewTenantSlugHistoryRecord = typeof tenantSlugHistory.$inferInsert;
