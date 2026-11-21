import { bigint, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// scope: primary
export const platformMetricsDaily = pgTable(
  'PlatformMetricsDaily',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    date: text('date').notNull(), // 'YYYY-MM-DD'
    mrrCents: integer('mrrCents').notNull().default(0),
    arrCents: integer('arrCents').notNull().default(0),
    activeTenants: integer('activeTenants').notNull().default(0),
    newTenants: integer('newTenants').notNull().default(0),
    churnedTenants: integer('churnedTenants').notNull().default(0),
    totalStorageBytes: bigint('totalStorageBytes', { mode: 'number' }).notNull().default(0),
    apiRequestsCount: integer('apiRequestsCount').notNull().default(0),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('PlatformMetricsDaily_date_idx').on(table.date)],
);

export type PlatformMetricsDaily = typeof platformMetricsDaily.$inferSelect;
export type NewPlatformMetricsDaily = typeof platformMetricsDaily.$inferInsert;
