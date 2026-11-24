import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { roles } from '../access/rbac';
import { addresses } from '../location/addresses';
import { tenants } from './tenants';

// scope: tenant
export const tenantSettings = pgTable(
  'TenantSetting',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en-US'),
    currency: text('currency').notNull().default('USD'),
    dateFormat: text('dateFormat').notNull().default('YYYY-MM-DD'),
    timeFormat: text('timeFormat').notNull().default('24h'),
    weekStartsOn: text('weekStartsOn').notNull().default('monday'),
    fiscalYearStartMonth: integer('fiscalYearStartMonth').notNull().default(1),
    country: text('country').notNull().default('US'),
    industry: text('industry'),
    companySize: text('companySize'),
    legalName: text('legalName'),
    taxId: text('taxId'),
    billingAddressId: uuid('billingAddressId').references(() => addresses.id, {
      onDelete: 'set null',
    }),
    supportEmail: text('supportEmail'),
    websiteUrl: text('websiteUrl'),
    termsUrl: text('termsUrl'),
    privacyUrl: text('privacyUrl'),
    defaultMemberRoleId: uuid('defaultMemberRoleId').references(() => roles.id, {
      onDelete: 'set null',
    }),
    allowedEmailDomains: text('allowedEmailDomains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    autoJoinDomains: boolean('autoJoinDomains').notNull().default(false),
    memberLimitNotified: boolean('memberLimitNotified').notNull().default(false),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('TenantSetting_tenantId_idx').on(table.tenantId),
    index('TenantSetting_createdAt_idx').on(table.createdAt),
  ],
);

export type TenantSettingRecord = typeof tenantSettings.$inferSelect;
export type NewTenantSettingRecord = typeof tenantSettings.$inferInsert;
