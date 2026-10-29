import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenantStatusEnum } from '../enums';

export const tenants = pgTable(
  'Tenant',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: tenantStatusEnum('status').notNull().default('ACTIVE'),
    plan: text('plan').notNull().default('FREE'),
    allowSupportAccess: boolean('allowSupportAccess').notNull().default(true),
    // Hybrid Shared / Dedicated Database Routing
    databaseMode: text('databaseMode').notNull().default('shared'), // 'shared' | 'dedicated'
    databaseKey: text('databaseKey').notNull().default('primary'), // trusted routing key
    databaseSecretRef: text('databaseSecretRef'), // AWS Secrets Manager reference, never password
    schemaVersion: text('schemaVersion').notNull().default('1.0.0'),

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
    index('Tenant_databaseMode_idx').on(table.databaseMode),
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
  databaseMode: tenants.databaseMode,
  createdAt: tenants.createdAt,
};

export type PublicTenant = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIALING' | 'DEACTIVATED';
  plan: string;
  databaseMode?: 'shared' | 'dedicated' | string;
  createdAt: Date;
};
