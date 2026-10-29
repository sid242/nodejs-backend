import { index, json, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { platformRoles } from './platform-roles';

export const platformStaff = pgTable(
  'PlatformStaff',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('passwordHash').notNull(),
    displayName: text('displayName').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE, SUSPENDED, DEACTIVATED
    roleId: uuid('roleId')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'restrict' }),

    // Two-Factor Authentication
    twoFactorSecret: text('twoFactorSecret'), // AES-256-GCM encrypted TOTP secret
    twoFactorEnabledAt: timestamp('twoFactorEnabledAt', { precision: 3, mode: 'date' }),
    twoFactorRecoveryCodes: json('twoFactorRecoveryCodes').$type<string[]>(), // bcrypt-hashed recovery codes

    lastLoginAt: timestamp('lastLoginAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('PlatformStaff_email_idx').on(table.email),
    index('PlatformStaff_roleId_idx').on(table.roleId),
    index('PlatformStaff_status_idx').on(table.status),
  ],
);

export type PlatformStaff = typeof platformStaff.$inferSelect;
export type NewPlatformStaff = typeof platformStaff.$inferInsert;

export const publicPlatformStaff = {
  id: platformStaff.id,
  email: platformStaff.email,
  displayName: platformStaff.displayName,
  status: platformStaff.status,
  roleId: platformStaff.roleId,
  twoFactorEnabledAt: platformStaff.twoFactorEnabledAt,
  lastLoginAt: platformStaff.lastLoginAt,
  createdAt: platformStaff.createdAt,
};
