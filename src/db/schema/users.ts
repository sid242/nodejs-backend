import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { roleEnum, userStatusEnum } from './enums.js';

export const users = pgTable(
  'User',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('passwordHash').notNull(),
    name: text('name').notNull(),
    role: roleEnum('role').notNull().default('USER'),
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

    // Soft delete & timestamps
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
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
  role: users.role,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  phoneNumber: users.phoneNumber,
  phoneVerifiedAt: users.phoneVerifiedAt,
  createdAt: users.createdAt,
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  emailVerifiedAt: Date | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: Date | null;
  createdAt: Date;
};
