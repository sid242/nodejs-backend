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

import { tenantMembers, tenants } from './tenants';

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
    name: text('name').notNull(),
    description: text('description'),
    action: text('action').notNull().default('manage'),
    category: text('category'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('Permission_moduleId_idx').on(table.moduleId)],
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
    name: text('name').notNull(),
    description: text('description'),
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
    uniqueIndex('AppRole_tenantId_name_idx').on(table.tenantId, table.name),
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
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.roleId] }),
    index('TenantMemberRole_memberId_idx').on(table.memberId),
    index('TenantMemberRole_roleId_idx').on(table.roleId),
  ],
);

export type TenantMemberRole = typeof tenantMemberRoles.$inferSelect;
export type NewTenantMemberRole = typeof tenantMemberRoles.$inferInsert;
