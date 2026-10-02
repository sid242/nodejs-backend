import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roleEnum } from './enums.js';

export const users = pgTable('User', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('passwordHash').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('USER'),
  emailVerifiedAt: timestamp('emailVerifiedAt', { precision: 3, mode: 'date' }),
  createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const publicUser = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  emailVerifiedAt: users.emailVerifiedAt,
  createdAt: users.createdAt,
};
