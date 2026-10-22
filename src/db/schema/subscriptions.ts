import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { plans } from './plans.js';
import { tenants } from './tenants/tenants.js';

export const subscriptions = pgTable(
  'Subscription',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('planId')
      .notNull()
      .references(() => plans.id),
    status: text('status').notNull().default('ACTIVE'), // 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
    seatCount: integer('seatCount').notNull().default(1),
    currentPeriodStart: timestamp('currentPeriodStart', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp('currentPeriodEnd', { precision: 3, mode: 'date' }),
    cancelAtPeriodEnd: boolean('cancelAtPeriodEnd').notNull().default(false),
    canceledAt: timestamp('canceledAt', { precision: 3, mode: 'date' }),
    trialEndsAt: timestamp('trialEndsAt', { precision: 3, mode: 'date' }),
    provider: text('provider').notNull().default('MOCK'), // 'MOCK' | 'STRIPE' | 'MANUAL'
    providerSubscriptionId: text('providerSubscriptionId'),
    providerCustomerId: text('providerCustomerId'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Subscription_tenantId_unique').on(table.tenantId),
    index('Subscription_planId_idx').on(table.planId),
    index('Subscription_status_idx').on(table.status),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export const publicSubscription = {
  id: subscriptions.id,
  tenantId: subscriptions.tenantId,
  planId: subscriptions.planId,
  status: subscriptions.status,
  seatCount: subscriptions.seatCount,
  currentPeriodStart: subscriptions.currentPeriodStart,
  currentPeriodEnd: subscriptions.currentPeriodEnd,
  cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
  trialEndsAt: subscriptions.trialEndsAt,
  createdAt: subscriptions.createdAt,
};
