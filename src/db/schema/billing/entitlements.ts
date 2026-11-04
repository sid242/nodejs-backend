import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { plans } from './plans';

export type EntitlementType = 'INTEGER' | 'BOOLEAN' | 'STRING';

export const entitlementDefinitions = pgTable(
  'EntitlementDefinition',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(), // e.g. 'members.max', 'storage.gb', 'groups.enabled', 'custom_domains.max', 'audit.retention_days', 'api_access.enabled'
    label: text('label').notNull(),
    description: text('description'),
    type: text('type').$type<EntitlementType>().notNull().default('INTEGER'),
    unit: text('unit'), // 'members', 'GB', 'days', etc.
    validation: jsonb('validation').$type<{ min?: number; max?: number; regex?: string }>(),
    defaultValue: jsonb('defaultValue').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('EntitlementDefinition_key_unique').on(table.key),
  ],
);

export const planEntitlements = pgTable(
  'PlanEntitlement',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planId: uuid('planId')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    entitlementKey: text('entitlementKey').notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('PlanEntitlement_plan_key_unique').on(table.planId, table.entitlementKey),
    index('PlanEntitlement_planId_idx').on(table.planId),
    index('PlanEntitlement_key_idx').on(table.entitlementKey),
  ],
);

export const tenantEntitlementOverrides = pgTable(
  'TenantEntitlementOverride',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entitlementKey: text('entitlementKey').notNull(),
    value: jsonb('value').notNull(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }),
    reason: text('reason'),
    createdBy: text('createdBy').notNull().default('system'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('TenantEntitlementOverride_tenant_key_idx').on(table.tenantId, table.entitlementKey),
    index('TenantEntitlementOverride_expiresAt_idx').on(table.expiresAt),
  ],
);

export const tenantUsageRecords = pgTable(
  'TenantUsageRecord',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entitlementKey: text('entitlementKey').notNull(),
    currentUsage: integer('currentUsage').notNull().default(0),
    lastRecordedAt: timestamp('lastRecordedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('TenantUsageRecord_tenant_key_unique').on(table.tenantId, table.entitlementKey),
    index('TenantUsageRecord_tenantId_idx').on(table.tenantId),
  ],
);

export const billingWebhooks = pgTable(
  'BillingWebhook',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(), // 'stripe', 'razorpay', 'manual'
    eventId: text('eventId').notNull(),
    eventType: text('eventType').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('PROCESSED'), // 'PENDING', 'PROCESSED', 'FAILED'
    processedAt: timestamp('processedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    errorMessage: text('errorMessage'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('BillingWebhook_provider_event_unique').on(table.provider, table.eventId),
    index('BillingWebhook_status_idx').on(table.status),
  ],
);

export type EntitlementDefinition = typeof entitlementDefinitions.$inferSelect;
export type NewEntitlementDefinition = typeof entitlementDefinitions.$inferInsert;
export type PlanEntitlement = typeof planEntitlements.$inferSelect;
export type NewPlanEntitlement = typeof planEntitlements.$inferInsert;
export type TenantEntitlementOverride = typeof tenantEntitlementOverrides.$inferSelect;
export type NewTenantEntitlementOverride = typeof tenantEntitlementOverrides.$inferInsert;
export type TenantUsageRecord = typeof tenantUsageRecords.$inferSelect;
export type NewTenantUsageRecord = typeof tenantUsageRecords.$inferInsert;
export type BillingWebhook = typeof billingWebhooks.$inferSelect;
export type NewBillingWebhook = typeof billingWebhooks.$inferInsert;

