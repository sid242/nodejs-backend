import { isNotNull, isNull } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../identity/users';
import { tenants } from '../tenancy/index';
import { roles } from './rbac';

export const policyEffectEnum = pgEnum('policy_effect', ['allow', 'deny']);

export const policies = pgTable(
  'Policy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }), // null for platform-scoped policies
    name: text('name').notNull(),
    description: text('description'),
    resource: text('resource').notNull(), // e.g., 'leads'
    action: text('action').notNull(), // e.g., 'read', 'update', 'delete', 'export', '*'
    effect: policyEffectEnum('effect').notNull().default('allow'),
    conditions: jsonb('conditions').notNull(), // validated JSON condition tree
    isActive: boolean('isActive').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    createdBy: uuid('createdBy').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updatedBy').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Policy_tenantId_resource_action_idx').on(table.tenantId, table.resource, table.action),
    index('Policy_tenantId_isActive_idx').on(table.tenantId, table.isActive),
    uniqueIndex('Policy_tenant_name_unique')
      .on(table.tenantId, table.name)
      .where(isNotNull(table.tenantId)),
    uniqueIndex('Policy_platform_name_unique').on(table.name).where(isNull(table.tenantId)),
  ],
);

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;
export type PolicyEffect = (typeof policyEffectEnum.enumValues)[number];

export const rolePolicies = pgTable(
  'RolePolicy',
  {
    roleId: uuid('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    policyId: uuid('policyId')
      .notNull()
      .references(() => policies.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.policyId] }),
    index('RolePolicy_roleId_idx').on(table.roleId),
    index('RolePolicy_policyId_idx').on(table.policyId),
    index('RolePolicy_tenantId_idx').on(table.tenantId),
  ],
);

export type RolePolicy = typeof rolePolicies.$inferSelect;
export type NewRolePolicy = typeof rolePolicies.$inferInsert;
