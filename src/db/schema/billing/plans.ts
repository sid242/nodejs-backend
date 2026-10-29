import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { appModules } from '../access/rbac';

export interface PlanLimits {
  maxMembers: number | null;
  maxStorageBytes: number | null;
  maxCustomRoles: number | null;
}

export const plans = pgTable(
  'Plan',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(), // 'FREE', 'PRO', 'ENTERPRISE'
    name: text('name').notNull(),
    description: text('description'),
    priceMonthlyMinor: integer('priceMonthlyMinor').notNull().default(0),
    priceYearlyMinor: integer('priceYearlyMinor').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    trialDays: integer('trialDays').notNull().default(14),
    limits: jsonb('limits').$type<PlanLimits>().notNull(),
    isPublic: boolean('isPublic').notNull().default(true),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Plan_key_unique').on(table.key),
    index('Plan_isActive_idx').on(table.isActive),
    index('Plan_sortOrder_idx').on(table.sortOrder),
  ],
);

export const planModules = pgTable(
  'PlanModule',
  {
    planId: uuid('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    moduleId: uuid('moduleId')
      .notNull()
      .references(() => appModules.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.moduleId] }),
    index('PlanModule_planId_idx').on(table.planId),
    index('PlanModule_moduleId_idx').on(table.moduleId),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanModule = typeof planModules.$inferSelect;
export type NewPlanModule = typeof planModules.$inferInsert;

export const publicPlan = {
  id: plans.id,
  key: plans.key,
  name: plans.name,
  description: plans.description,
  priceMonthlyMinor: plans.priceMonthlyMinor,
  priceYearlyMinor: plans.priceYearlyMinor,
  currency: plans.currency,
  trialDays: plans.trialDays,
  limits: plans.limits,
  isPublic: plans.isPublic,
  isActive: plans.isActive,
  sortOrder: plans.sortOrder,
  createdAt: plans.createdAt,
};
