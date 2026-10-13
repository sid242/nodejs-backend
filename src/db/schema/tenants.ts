import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { membershipStatusEnum, tenantStatusEnum } from './enums.js';
import { users } from './users.js';

export const tenants = pgTable(
  'Tenant',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: tenantStatusEnum('status').notNull().default('ACTIVE'),
    plan: text('plan').notNull().default('FREE'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),
  },
  (table) => [
    index('Tenant_status_idx').on(table.status),
    index('Tenant_createdAt_idx').on(table.createdAt),
    index('Tenant_deletedAt_idx').on(table.deletedAt),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export const publicTenant = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  status: tenants.status,
  plan: tenants.plan,
  createdAt: tenants.createdAt,
};

export type PublicTenant = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIALING' | 'DEACTIVATED';
  plan: string;
  createdAt: Date;
};

export const tenantMembers = pgTable(
  'TenantMember',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: membershipStatusEnum('status').notNull().default('ACTIVE'),
    joinedAt: timestamp('joinedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('TenantMember_tenantId_userId_unique').on(table.tenantId, table.userId),
    index('TenantMember_userId_status_idx').on(table.userId, table.status),
    index('TenantMember_tenantId_status_idx').on(table.tenantId, table.status),
  ],
);

export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
