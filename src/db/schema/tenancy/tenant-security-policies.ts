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

import { tenants } from './tenants';

// scope: tenant
export const tenantSecurityPolicies = pgTable(
  'TenantSecurityPolicy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requireMfa: text('requireMfa').notNull().default('NONE'), // ALL | ADMINS | NONE
    passwordMinLength: integer('passwordMinLength').notNull().default(8),
    passwordMaxAgeDays: integer('passwordMaxAgeDays'), // null = no expiration
    sessionIdleMinutes: integer('sessionIdleMinutes').notNull().default(60),
    sessionMaxHours: integer('sessionMaxHours').notNull().default(24),
    ipAllowlist: text('ipAllowlist')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedAuthMethods: text('allowedAuthMethods')
      .array()
      .notNull()
      .default(sql`ARRAY['PASSWORD', 'MAGIC', 'SSO']::text[]`),
    enforceSso: boolean('enforceSso').notNull().default(false),
    allowSupportAccess: boolean('allowSupportAccess').notNull().default(true),
    inviteExpiryDays: integer('inviteExpiryDays').notNull().default(7),
    allowPersonalEmails: boolean('allowPersonalEmails').notNull().default(true),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('TenantSecurityPolicy_tenantId_idx').on(table.tenantId),
    index('TenantSecurityPolicy_createdAt_idx').on(table.createdAt),
  ],
);

export type TenantSecurityPolicyRecord = typeof tenantSecurityPolicies.$inferSelect;
export type NewTenantSecurityPolicyRecord = typeof tenantSecurityPolicies.$inferInsert;
