import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { platformRoles } from './platform-roles';
import { platformStaff } from './platform-staff';

export const platformUserGroups = pgTable(
  'PlatformUserGroup',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('PlatformUserGroup_key_idx').on(table.key)],
);

export const platformUserGroupMembers = pgTable(
  'PlatformUserGroupMember',
  {
    groupId: uuid('groupId')
      .notNull()
      .references(() => platformUserGroups.id, { onDelete: 'cascade' }),
    staffId: uuid('staffId')
      .notNull()
      .references(() => platformStaff.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.staffId] }),
    index('PlatformUserGroupMember_staffId_idx').on(table.staffId),
  ],
);

export const platformUserGroupRoles = pgTable(
  'PlatformUserGroupRole',
  {
    groupId: uuid('groupId')
      .notNull()
      .references(() => platformUserGroups.id, { onDelete: 'cascade' }),
    roleId: uuid('roleId')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.roleId] }),
    index('PlatformUserGroupRole_roleId_idx').on(table.roleId),
  ],
);
