import { isNotNull } from 'drizzle-orm';
import { index, json, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { platformStaffStatusEnum } from '../enums';
import { users } from '../identity/users';
import { platformRoles } from './platform-roles';

export const platformStaff = pgTable(
  'PlatformStaff',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId').references(() => users.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    passwordHash: text('passwordHash').notNull(),
    displayName: text('displayName').notNull(),
    employeeCode: text('employeeCode'),
    department: text('department'),
    jobTitle: text('jobTitle'),
    status: platformStaffStatusEnum('status').notNull().default('ACTIVE'),
    roleId: uuid('roleId')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'restrict' }),

    // Invitation lifecycle
    invitedAt: timestamp('invitedAt', { precision: 3, mode: 'date' }),
    inviteTokenHash: text('inviteTokenHash'),
    inviteExpiresAt: timestamp('inviteExpiresAt', { precision: 3, mode: 'date' }),
    invitationMessage: text('invitationMessage'),

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
    uniqueIndex('PlatformStaff_employeeCode_idx').on(table.employeeCode).where(isNotNull(table.employeeCode)),
    index('PlatformStaff_userId_idx').on(table.userId),
    index('PlatformStaff_roleId_idx').on(table.roleId),
    index('PlatformStaff_status_idx').on(table.status),
    index('PlatformStaff_department_idx').on(table.department),
    index('PlatformStaff_inviteTokenHash_idx').on(table.inviteTokenHash),
  ],
);

export type PlatformStaff = typeof platformStaff.$inferSelect;
export type NewPlatformStaff = typeof platformStaff.$inferInsert;

export const publicPlatformStaff = {
  id: platformStaff.id,
  userId: platformStaff.userId,
  email: platformStaff.email,
  displayName: platformStaff.displayName,
  employeeCode: platformStaff.employeeCode,
  department: platformStaff.department,
  jobTitle: platformStaff.jobTitle,
  status: platformStaff.status,
  roleId: platformStaff.roleId,
  invitedAt: platformStaff.invitedAt,
  invitationMessage: platformStaff.invitationMessage,
  twoFactorEnabledAt: platformStaff.twoFactorEnabledAt,
  lastLoginAt: platformStaff.lastLoginAt,
  createdAt: platformStaff.createdAt,
};
