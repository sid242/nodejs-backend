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

export const tenantEmailConfigs = pgTable(
  'TenantEmailConfig',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    port: integer('port').notNull().default(587),
    secure: boolean('secure').notNull().default(false),
    user: text('user').notNull(),
    passwordEncrypted: text('passwordEncrypted').notNull(),
    fromEmail: text('fromEmail').notNull(),
    fromName: text('fromName'),
    replyTo: text('replyTo'),
    isEnabled: boolean('isEnabled').notNull().default(true),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('TenantEmailConfig_tenantId_unique').on(table.tenantId),
    index('TenantEmailConfig_tenantId_idx').on(table.tenantId),
  ],
);

export type TenantEmailConfig = typeof tenantEmailConfigs.$inferSelect;
export type NewTenantEmailConfig = typeof tenantEmailConfigs.$inferInsert;

export const publicTenantEmailConfig = {
  id: tenantEmailConfigs.id,
  tenantId: tenantEmailConfigs.tenantId,
  host: tenantEmailConfigs.host,
  port: tenantEmailConfigs.port,
  secure: tenantEmailConfigs.secure,
  user: tenantEmailConfigs.user,
  fromEmail: tenantEmailConfigs.fromEmail,
  fromName: tenantEmailConfigs.fromName,
  replyTo: tenantEmailConfigs.replyTo,
  isEnabled: tenantEmailConfigs.isEnabled,
  createdAt: tenantEmailConfigs.createdAt,
  updatedAt: tenantEmailConfigs.updatedAt,
};

export type PublicTenantEmailConfig = {
  id: string;
  tenantId: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  isEnabled: boolean;
  hasPassword?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const tenantBrandings = pgTable(
  'TenantBranding',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyName: text('companyName'),
    logoUrl: text('logoUrl'),
    logoDarkUrl: text('logoDarkUrl'),
    faviconUrl: text('faviconUrl'),
    primaryColor: text('primaryColor').notNull().default('#4F46E5'),
    accentColor: text('accentColor').notNull().default('#06B6D4'),
    borderRadius: text('borderRadius').notNull().default('0.5rem'),
    customDomain: text('customDomain'),
    customDomainStatus: text('customDomainStatus').notNull().default('PENDING'),
    supportEmail: text('supportEmail'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('TenantBranding_tenantId_unique').on(table.tenantId),
    uniqueIndex('TenantBranding_customDomain_unique').on(table.customDomain),
    index('TenantBranding_customDomain_idx').on(table.customDomain),
  ],
);

export type TenantBranding = typeof tenantBrandings.$inferSelect;
export type NewTenantBranding = typeof tenantBrandings.$inferInsert;

export const publicTenantBranding = {
  id: tenantBrandings.id,
  tenantId: tenantBrandings.tenantId,
  companyName: tenantBrandings.companyName,
  logoUrl: tenantBrandings.logoUrl,
  logoDarkUrl: tenantBrandings.logoDarkUrl,
  faviconUrl: tenantBrandings.faviconUrl,
  primaryColor: tenantBrandings.primaryColor,
  accentColor: tenantBrandings.accentColor,
  borderRadius: tenantBrandings.borderRadius,
  customDomain: tenantBrandings.customDomain,
  customDomainStatus: tenantBrandings.customDomainStatus,
  supportEmail: tenantBrandings.supportEmail,
  createdAt: tenantBrandings.createdAt,
  updatedAt: tenantBrandings.updatedAt,
};

export type PublicTenantBranding = typeof tenantBrandings.$inferSelect;
