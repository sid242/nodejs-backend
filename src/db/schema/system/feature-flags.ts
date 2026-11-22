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

import { featureFlagTargetEnum, featureFlagTypeEnum } from '../enums';
import { platformStaff } from '../platform/platform-staff';

// scope: primary
export const featureFlags = pgTable(
  'FeatureFlag',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    type: featureFlagTypeEnum('type').notNull().default('BOOLEAN'),
    defaultValue: jsonb('defaultValue').notNull().default(false),
    ownerStaffId: uuid('ownerStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    killSwitch: boolean('killSwitch').notNull().default(false),
    tags: text('tags').array(),
    lastEvaluatedAt: timestamp('lastEvaluatedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('FeatureFlag_key_idx').on(table.key),
    index('FeatureFlag_type_idx').on(table.type),
    index('FeatureFlag_killSwitch_idx').on(table.killSwitch),
  ],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;

// scope: primary
export const featureFlagRules = pgTable(
  'FeatureFlagRule',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flagId: uuid('flagId')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),
    flagKey: text('flagKey').notNull(),
    priority: integer('priority').notNull().default(0),
    target: featureFlagTargetEnum('target').notNull(),
    matchCriteria: jsonb('matchCriteria'),
    value: jsonb('value').notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('FeatureFlagRule_flagId_priority_idx').on(table.flagId, table.priority),
    index('FeatureFlagRule_flagKey_idx').on(table.flagKey),
  ],
);

export type FeatureFlagRule = typeof featureFlagRules.$inferSelect;
export type NewFeatureFlagRule = typeof featureFlagRules.$inferInsert;
