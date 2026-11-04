import { isNotNull, isNull } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { userGroups } from '../identity/user-groups';
import { tenantMembers, tenants } from '../tenancy/index';

export const appModules = pgTable(
  'AppModule',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sortOrder').notNull().default(0),
    isSystem: boolean('isSystem').notNull().default(false),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('AppModule_sortOrder_idx').on(table.sortOrder)],
);

export type AppModule = typeof appModules.$inferSelect;
export type NewAppModule = typeof appModules.$inferInsert;

export const permissions = pgTable(
  'Permission',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    moduleId: uuid('moduleId')
      .notNull()
      .references(() => appModules.id, { onDelete: 'cascade' }),
    key: text('key').notNull().unique(),
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'),
    scope: text('scope').notNull().default('TENANT'),
    resource: text('resource'),
    action: text('action').notNull().default('manage'),
    category: text('category'),
    riskLevel: text('riskLevel').notNull().default('LOW'),
    isSystem: boolean('isSystem').notNull().default(true),
    isAssignable: boolean('isAssignable').notNull().default(true),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('Permission_moduleId_idx').on(table.moduleId),
    index('Permission_scope_idx').on(table.scope),
    index('Permission_resource_idx').on(table.resource),
  ],
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;

export const tenantModules = pgTable(
  'TenantModule',
  {
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    moduleId: uuid('moduleId')
      .notNull()
      .references(() => appModules.id, { onDelete: 'cascade' }),
    isEnabled: boolean('isEnabled').notNull().default(true),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.moduleId] }),
    index('TenantModule_tenantId_idx').on(table.tenantId),
  ],
);

export type TenantModule = typeof tenantModules.$inferSelect;
export type NewTenantModule = typeof tenantModules.$inferInsert;

export const roles = pgTable(
  'AppRole',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'),
    scope: text('scope').notNull().default('TENANT'),
    isActive: boolean('isActive').notNull().default(true),
    isSystem: boolean('isSystem').notNull().default(false),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('AppRole_tenantId_idx').on(table.tenantId),
    index('AppRole_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('AppRole_scope_idx').on(table.scope),
    index('AppRole_isActive_idx').on(table.isActive),
    uniqueIndex('AppRole_tenant_name_unique').on(table.tenantId, table.name).where(isNotNull(table.tenantId)),
    uniqueIndex('AppRole_system_name_unique').on(table.name).where(isNull(table.tenantId)),
    uniqueIndex('AppRole_tenant_code_unique').on(table.tenantId, table.code).where(isNotNull(table.tenantId)),
    uniqueIndex('AppRole_system_code_unique').on(table.code).where(isNull(table.tenantId)),
  ],
);

export type RoleRecord = typeof roles.$inferSelect;
export type NewRoleRecord = typeof roles.$inferInsert;

export const rolePermissions = pgTable(
  'RolePermission',
  {
    roleId: uuid('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permissionId')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('RolePermission_roleId_idx').on(table.roleId),
    index('RolePermission_permissionId_idx').on(table.permissionId),
  ],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;

export const tenantMemberRoles = pgTable(
  'TenantMemberRole',
  {
    memberId: uuid('memberId')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'cascade' }),
    roleId: uuid('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.roleId] }),
    index('TenantMemberRole_memberId_idx').on(table.memberId),
    index('TenantMemberRole_roleId_idx').on(table.roleId),
    index('TenantMemberRole_tenantId_idx').on(table.tenantId),
  ],
);

export type TenantMemberRole = typeof tenantMemberRoles.$inferSelect;
export type NewTenantMemberRole = typeof tenantMemberRoles.$inferInsert;

export const userGroupRoles = pgTable(
  'UserGroupRole',
  {
    groupId: uuid('groupId')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    roleId: uuid('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.roleId] }),
    index('UserGroupRole_roleId_idx').on(table.roleId),
    index('UserGroupRole_groupId_idx').on(table.groupId),
  ],
);

export type UserGroupRole = typeof userGroupRoles.$inferSelect;
export type NewUserGroupRole = typeof userGroupRoles.$inferInsert;
