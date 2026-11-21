import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { tenantMembers } from '../tenancy/tenant-members';

// scope: tenant
export const usageEvents = pgTable(
  'UsageEvent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    meter: text('meter').notNull(), // 'members.active' | 'storage.bytes' | 'api.requests' | 'emails.sent' | 'webhooks.deliveries' | 'sso.logins'
    quantity: bigint('quantity', { mode: 'number' }).notNull().default(1),
    unit: text('unit').notNull().default('count'),
    occurredAt: timestamp('occurredAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    actorMemberId: uuid('actorMemberId').references(() => tenantMembers.id, { onDelete: 'set null' }),
    resourceType: text('resourceType'),
    resourceId: text('resourceId'),
    idempotencyKey: text('idempotencyKey'),
  },
  (table) => [
    uniqueIndex('UsageEvent_idempotency_idx').on(table.idempotencyKey),
    index('UsageEvent_tenant_meter_date_idx').on(table.tenantId, table.meter, table.occurredAt),
    index('UsageEvent_tenant_occurredAt_idx').on(table.tenantId, table.occurredAt),
  ],
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

// scope: tenant
export const usageDaily = pgTable(
  'UsageDaily',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    meter: text('meter').notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD'
    quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
    unit: text('unit').notNull().default('count'),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('UsageDaily_tenant_meter_date_idx').on(table.tenantId, table.meter, table.date),
    index('UsageDaily_tenantId_date_idx').on(table.tenantId, table.date),
  ],
);

export type UsageDaily = typeof usageDaily.$inferSelect;
export type NewUsageDaily = typeof usageDaily.$inferInsert;
