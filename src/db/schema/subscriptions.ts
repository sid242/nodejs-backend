import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { actorTypeEnum, subscriptionStatusEnum } from './enums';
import { plans } from './plans';
import { tenants } from './tenants/tenants';

export const subscriptions = pgTable(
  'Subscription',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull().default('TRIALING'),
    trialEndsAt: timestamp('trialEndsAt', { precision: 3, mode: 'date' }),
    currentPeriodStart: timestamp('currentPeriodStart', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp('currentPeriodEnd', { precision: 3, mode: 'date' }),
    cancelAtPeriodEnd: boolean('cancelAtPeriodEnd').notNull().default(false),
    provider: text('provider').notNull().default('manual'),
    providerCustomerId: text('providerCustomerId'),
    providerSubscriptionId: text('providerSubscriptionId'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Subscription_tenantId_active_unique')
      .on(table.tenantId)
      .where(sql`${table.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`),
    index('Subscription_tenantId_idx').on(table.tenantId),
    index('Subscription_planId_idx').on(table.planId),
    index('Subscription_status_idx').on(table.status),
  ],
);

export const subscriptionEvents = pgTable(
  'SubscriptionEvent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subscriptionId: uuid('subscriptionId').notNull(),
    tenantId: uuid('tenantId').notNull(),
    type: text('type').notNull(), // 'CREATED', 'PLAN_CHANGED', 'CANCELED', 'EXPIRED', 'CHANGE_REQUESTED'
    fromPlanId: uuid('fromPlanId'),
    toPlanId: uuid('toPlanId'),
    actorType: actorTypeEnum('actorType').notNull().default('USER'),
    actorId: text('actorId').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('SubscriptionEvent_tenantId_idx').on(table.tenantId),
    index('SubscriptionEvent_subscriptionId_idx').on(table.subscriptionId),
    index('SubscriptionEvent_createdAt_idx').on(table.createdAt),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEvent = typeof subscriptionEvents.$inferInsert;

export const publicSubscription = {
  id: subscriptions.id,
  tenantId: subscriptions.tenantId,
  planId: subscriptions.planId,
  status: subscriptions.status,
  trialEndsAt: subscriptions.trialEndsAt,
  currentPeriodStart: subscriptions.currentPeriodStart,
  currentPeriodEnd: subscriptions.currentPeriodEnd,
  cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
  provider: subscriptions.provider,
  createdAt: subscriptions.createdAt,
};
