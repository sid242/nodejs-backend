import { isNotNull, sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { userGroupScopeEnum, userGroupStatusEnum } from '../enums';
import { platformStaff } from '../platform/platform-staff';
import { tenants } from '../tenancy/tenants';
import { users } from './users';

export const userGroups = pgTable(
  'UserGroup',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    scope: userGroupScopeEnum('scope').notNull().default('TENANT'),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    status: userGroupStatusEnum('status').notNull().default('ACTIVE'),
    createdBy: uuid('createdBy'),
    updatedBy: uuid('updatedBy'),
    archivedAt: timestamp('archivedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('UserGroup_platform_slug_unique')
      .on(table.slug)
      .where(sql`"scope" = 'PLATFORM' AND "archivedAt" IS NULL`),
    uniqueIndex('UserGroup_tenant_slug_unique')
      .on(table.tenantId, table.slug)
      .where(sql`"scope" = 'TENANT' AND "archivedAt" IS NULL`),
    index('UserGroup_scope_status_idx').on(table.scope, table.status),
    index('UserGroup_tenantId_status_idx').on(table.tenantId, table.status),
    index('UserGroup_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('UserGroup_scope_createdAt_idx').on(table.scope, table.createdAt),
  ],
);

export type UserGroup = typeof userGroups.$inferSelect;
export type NewUserGroup = typeof userGroups.$inferInsert;

export const userGroupMembers = pgTable(
  'UserGroupMember',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('groupId')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: uuid('userId').references(() => users.id, { onDelete: 'cascade' }),
    staffId: uuid('staffId').references(() => platformStaff.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    addedBy: uuid('addedBy'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('UserGroupMember_group_user_unique')
      .on(table.groupId, table.userId)
      .where(isNotNull(table.userId)),
    uniqueIndex('UserGroupMember_group_staff_unique')
      .on(table.groupId, table.staffId)
      .where(isNotNull(table.staffId)),
    index('UserGroupMember_groupId_idx').on(table.groupId),
    index('UserGroupMember_userId_idx').on(table.userId),
    index('UserGroupMember_staffId_idx').on(table.staffId),
    index('UserGroupMember_tenantId_idx').on(table.tenantId),
  ],
);

export type UserGroupMember = typeof userGroupMembers.$inferSelect;
export type NewUserGroupMember = typeof userGroupMembers.$inferInsert;
