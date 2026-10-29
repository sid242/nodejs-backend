import { isNull } from 'drizzle-orm';
import { index, integer, json, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { userStatusEnum } from './enums';

export const users = pgTable(
  'User',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('passwordHash').notNull(),
    name: text('name').notNull(),
    status: userStatusEnum('status').notNull().default('PENDING_VERIFICATION'),

    // Verification details
    emailVerifiedAt: timestamp('emailVerifiedAt', { precision: 3, mode: 'date' }),
    pendingEmail: text('pendingEmail'),
    phoneNumber: text('phoneNumber'),
    phoneVerifiedAt: timestamp('phoneVerifiedAt', { precision: 3, mode: 'date' }),

    // Security & Lockout
    passwordChangedAt: timestamp('passwordChangedAt', { precision: 3, mode: 'date' }),
    failedLoginAttempts: integer('failedLoginAttempts').notNull().default(0),
    lockedUntil: timestamp('lockedUntil', { precision: 3, mode: 'date' }),
    lastLoginAt: timestamp('lastLoginAt', { precision: 3, mode: 'date' }),

    // Two-Factor Authentication
    twoFactorSecret: text('twoFactorSecret'), // AES-256-GCM encrypted TOTP secret (null = 2FA disabled)
    twoFactorEnabledAt: timestamp('twoFactorEnabledAt', { precision: 3, mode: 'date' }),
    twoFactorRecoveryCodes: json('twoFactorRecoveryCodes').$type<string[]>(), // bcrypt-hashed single-use recovery codes

    // Soft delete & timestamps
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('User_email_active_unique').on(table.email).where(isNull(table.deletedAt)),
    index('User_status_idx').on(table.status),
    index('User_createdAt_idx').on(table.createdAt),
    index('User_deletedAt_idx').on(table.deletedAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const publicUser = {
  id: users.id,
  email: users.email,
  name: users.name,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  phoneNumber: users.phoneNumber,
  phoneVerifiedAt: users.phoneVerifiedAt,
  twoFactorEnabledAt: users.twoFactorEnabledAt,
  createdAt: users.createdAt,
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  emailVerifiedAt: Date | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: Date | null;
  twoFactorEnabledAt?: Date | null;
  createdAt: Date;
};
