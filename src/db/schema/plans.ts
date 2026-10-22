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

export const plans = pgTable(
  'Plan',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(), // 'FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'
    name: text('name').notNull(),
    description: text('description'),
    priceCents: integer('priceCents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    billingInterval: text('billingInterval').notNull().default('MONTHLY'), // 'MONTHLY', 'ANNUAL', 'LIFETIME'
    isActive: boolean('isActive').notNull().default(true),
    isPublic: boolean('isPublic').notNull().default(true),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Plan_key_unique').on(table.key),
    index('Plan_isActive_idx').on(table.isActive),
  ],
);

export const planEntitlements = pgTable(
  'PlanEntitlement',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planId: uuid('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    maxMembers: integer('maxMembers').notNull().default(5), // Seat limit
    maxProjects: integer('maxProjects').notNull().default(10),
    maxStorageMb: integer('maxStorageMb').notNull().default(1024), // 1 GB
    hasCustomRoles: boolean('hasCustomRoles').notNull().default(false),
    hasAdvancedAnalytics: boolean('hasAdvancedAnalytics').notNull().default(false),
    hasPrioritySupport: boolean('hasPrioritySupport').notNull().default(false),
    hasAuditRetentionDays: integer('hasAuditRetentionDays').notNull().default(7),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('PlanEntitlement_planId_unique').on(table.planId)],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanEntitlement = typeof planEntitlements.$inferSelect;
export type NewPlanEntitlement = typeof planEntitlements.$inferInsert;

export const publicPlan = {
  id: plans.id,
  key: plans.key,
  name: plans.name,
  description: plans.description,
  priceCents: plans.priceCents,
  currency: plans.currency,
  billingInterval: plans.billingInterval,
  isActive: plans.isActive,
  isPublic: plans.isPublic,
  createdAt: plans.createdAt,
};
