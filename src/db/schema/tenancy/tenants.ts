import { isNotNull } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenantStatusEnum } from '../enums';

export const tenants = pgTable(
  'Tenant',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: tenantStatusEnum('status').notNull().default('ACTIVE'),
    plan: text('plan').notNull().default('FREE'),
    urlStyle: text('urlStyle').notNull().default('path'), // 'path' | 'subdomain' | 'customDomain'
    allowSupportAccess: boolean('allowSupportAccess').notNull().default(true),

    // Organization details
    legalName: text('legalName'),
    tenantCode: text('tenantCode'),
    country: text('country'),
    region: text('region'),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en-US'),
    currency: text('currency').notNull().default('USD'),
    supportEmail: text('supportEmail'),
    supportPhone: text('supportPhone'),
    billingEmail: text('billingEmail'),
    internalNote: text('internalNote'),

    // Provisioning Lifecycle & Diagnostics
    provisioningStatus: text('provisioningStatus').notNull().default('ACTIVE'), // PENDING | PROVISIONING | ACTIVE | FAILED | SUSPENDED | DEACTIVATED
    provisioningStep: text('provisioningStep'),
    provisioningError: text('provisioningError'),
    trialEndsAt: timestamp('trialEndsAt', { precision: 3, mode: 'date' }),

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
    uniqueIndex('Tenant_tenantCode_idx').on(table.tenantCode).where(isNotNull(table.tenantCode)),
    index('Tenant_status_idx').on(table.status),
    index('Tenant_databaseMode_idx').on(table.databaseMode),
    index('Tenant_country_idx').on(table.country),
    index('Tenant_provisioningStatus_idx').on(table.provisioningStatus),
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
  legalName: tenants.legalName,
  tenantCode: tenants.tenantCode,
  country: tenants.country,
  region: tenants.region,
  timezone: tenants.timezone,
  locale: tenants.locale,
  currency: tenants.currency,
  supportEmail: tenants.supportEmail,
  supportPhone: tenants.supportPhone,
  billingEmail: tenants.billingEmail,
  status: tenants.status,
  plan: tenants.plan,
  urlStyle: tenants.urlStyle,
  provisioningStatus: tenants.provisioningStatus,
  trialEndsAt: tenants.trialEndsAt,
  databaseMode: tenants.databaseMode,
  createdAt: tenants.createdAt,
};

export type PublicTenant = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIALING' | 'DEACTIVATED';
  plan: string;
  urlStyle?: 'path' | 'subdomain' | 'customDomain' | string;
  databaseMode?: 'shared' | 'dedicated' | string;
  legalName?: string | null;
  tenantCode?: string | null;
  country?: string | null;
  region?: string | null;
  timezone?: string;
  currency?: string;
  provisioningStatus?: string;
  createdAt: Date;
};
