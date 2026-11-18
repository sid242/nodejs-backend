import { isNull } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { userStatusEnum } from '../enums';

// scope: primary
export const users = pgTable(
  'User',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('passwordHash'),
    name: text('name').notNull(),
    avatarUrl: text('avatarUrl'),
    status: userStatusEnum('status').notNull().default('PENDING_VERIFICATION'),
    authMethod: text('authMethod').notNull().default('PASSWORD'),

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

    // Profile & Preferences
    firstName: text('firstName'),
    lastName: text('lastName'),
    locale: text('locale').default('en'),
    timezone: text('timezone').default('UTC'),
    dateFormat: text('dateFormat').default('YYYY-MM-DD'),
    lastPasswordResetAt: timestamp('lastPasswordResetAt', { precision: 3, mode: 'date' }),
    termsAcceptedAt: timestamp('termsAcceptedAt', { precision: 3, mode: 'date' }),
    termsVersion: text('termsVersion'),
    marketingOptIn: boolean('marketingOptIn').default(false),
    lastSeenAt: timestamp('lastSeenAt', { precision: 3, mode: 'date' }),

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
  firstName: users.firstName,
  lastName: users.lastName,
  avatarUrl: users.avatarUrl,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  phoneNumber: users.phoneNumber,
  phoneVerifiedAt: users.phoneVerifiedAt,
  twoFactorEnabledAt: users.twoFactorEnabledAt,
  locale: users.locale,
  timezone: users.timezone,
  dateFormat: users.dateFormat,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  emailVerifiedAt: Date | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: Date | null;
  twoFactorEnabledAt?: Date | null;
  locale?: string | null;
  timezone?: string | null;
  dateFormat?: string | null;
  lastLoginAt?: Date | null;
  createdAt: Date;
};
