import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { platformRoles } from './platform-roles.js';

export const platformStaff = pgTable(
  'PlatformStaff',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('passwordHash').notNull(),
    displayName: text('displayName').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE, SUSPENDED, DEACTIVATED
    roleId: uuid('roleId')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'restrict' }),
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
  lastLoginAt: platformStaff.lastLoginAt,
  createdAt: platformStaff.createdAt,
};
