import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { plans } from './plans';
import { subscriptions } from './subscriptions';

/**
 * Tracks subscription plan change requests and their outcomes.
 * Records upgrade, downgrade, and cancellation operations.
 */
export const subscriptionChanges = pgTable(
  'SubscriptionChange',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscriptionId')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    fromPlanId: uuid('fromPlanId').references(() => plans.id, { onDelete: 'set null' }),
    toPlanId: uuid('toPlanId').references(() => plans.id, { onDelete: 'set null' }),
    changeType: text('changeType').notNull(), // 'UPGRADE' | 'DOWNGRADE' | 'CANCELLATION' | 'RENEWAL'
    effectiveAt: timestamp('effectiveAt', { precision: 3, mode: 'date' }),
    prorationAmountMinor: integer('prorationAmountMinor'), // Proration difference (if applicable)
    status: text('status').notNull().default('PENDING'),
    // 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    requestedBy: text('requestedBy').notNull(), // User or Staff ID
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('SubscriptionChange_tenantId_idx').on(table.tenantId),
    index('SubscriptionChange_subscriptionId_idx').on(table.subscriptionId),
    index('SubscriptionChange_status_idx').on(table.status),
    index('SubscriptionChange_createdAt_idx').on(table.createdAt),
  ],
);

export type SubscriptionChange = typeof subscriptionChanges.$inferSelect;
export type NewSubscriptionChange = typeof subscriptionChanges.$inferInsert;
