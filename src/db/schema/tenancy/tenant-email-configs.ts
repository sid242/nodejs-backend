import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants';

// scope: tenant
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
    lastTestedAt: timestamp('lastTestedAt', { precision: 3, mode: 'date' }),
    lastTestStatus: text('lastTestStatus'),
    dkimVerified: boolean('dkimVerified').notNull().default(false),
    spfVerified: boolean('spfVerified').notNull().default(false),
    dailyLimit: integer('dailyLimit').notNull().default(1000),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('TenantEmailConfig_tenantId_unique').on(table.tenantId)],
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
  lastTestedAt: tenantEmailConfigs.lastTestedAt,
  lastTestStatus: tenantEmailConfigs.lastTestStatus,
  dkimVerified: tenantEmailConfigs.dkimVerified,
  spfVerified: tenantEmailConfigs.spfVerified,
  dailyLimit: tenantEmailConfigs.dailyLimit,
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
  lastTestedAt?: Date | null;
  lastTestStatus?: string | null;
  dkimVerified: boolean;
  spfVerified: boolean;
  dailyLimit: number;
  hasPassword?: boolean;
  createdAt: Date;
  updatedAt: Date;
};
