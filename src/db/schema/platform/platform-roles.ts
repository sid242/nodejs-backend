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

export const platformRoles = pgTable(
  'PlatformRole',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(), // e.g. SUPER_ADMIN, SUPPORT_STAFF, BILLING_STAFF, etc.
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('isSystem').notNull().default(false),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('PlatformRole_key_idx').on(table.key),
    index('PlatformRole_isActive_idx').on(table.isActive),
  ],
);

export type PlatformRole = typeof platformRoles.$inferSelect;
export type NewPlatformRole = typeof platformRoles.$inferInsert;

export const platformPermissions = pgTable(
  'PlatformPermission',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(), // resource::action format (e.g. platform_staff::read)
    name: text('name').notNull(),
    description: text('description'),
    resource: text('resource').notNull(), // e.g. platform_staff, tenants, billing, platform_audit
    action: text('action').notNull(), // e.g. read, create, update, disable, suspend, manage
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('PlatformPermission_key_idx').on(table.key),
    index('PlatformPermission_resource_idx').on(table.resource),
  ],
);

export type PlatformPermission = typeof platformPermissions.$inferSelect;
export type NewPlatformPermission = typeof platformPermissions.$inferInsert;

export const platformRolePermissions = pgTable(
  'PlatformRolePermission',
  {
    roleId: uuid('roleId')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permissionId')
      .notNull()
      .references(() => platformPermissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('PlatformRolePermission_roleId_idx').on(table.roleId),
    index('PlatformRolePermission_permissionId_idx').on(table.permissionId),
  ],
);

export type PlatformRolePermission = typeof platformRolePermissions.$inferSelect;
export type NewPlatformRolePermission = typeof platformRolePermissions.$inferInsert;
