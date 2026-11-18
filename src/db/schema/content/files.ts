import { bigint, boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { fileScanStatusEnum, fileStatusEnum, fileVisibilityEnum } from '../enums';
import { tenants } from '../tenancy/index';
import { users } from '../identity/users';

// scope: tenant
export const fileFolders = pgTable(
  'FileFolder',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parentId').references((): any => fileFolders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdBy: uuid('createdBy')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('FileFolder_tenantId_parentId_idx').on(table.tenantId, table.parentId),
    index('FileFolder_tenantId_name_idx').on(table.tenantId, table.name),
  ],
);

// scope: tenant
export const files = pgTable(
  'File',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('contentType').notNull(),
    size: bigint('size', { mode: 'number' }),
    status: fileStatusEnum('status').notNull().default('PENDING'),
    ownerId: uuid('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    folderId: uuid('folderId').references(() => fileFolders.id, { onDelete: 'set null' }),
    checksumSha256: text('checksumSha256'),
    etag: text('etag'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('durationMs'),
    scanStatus: fileScanStatusEnum('scanStatus').notNull().default('CLEAN'),
    scannedAt: timestamp('scannedAt', { precision: 3, mode: 'date' }),
    visibility: fileVisibilityEnum('visibility').notNull().default('PRIVATE'),
    description: text('description'),
    tags: text('tags').array(),
    isDeleted: boolean('isDeleted').notNull().default(false),
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),
    deletedByMemberId: uuid('deletedByMemberId'),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    sourceModule: text('sourceModule'),
    lastAccessedAt: timestamp('lastAccessedAt', { precision: 3, mode: 'date' }),
    downloadCount: integer('downloadCount').notNull().default(0),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('File_ownerId_createdAt_idx').on(table.ownerId, table.createdAt),
    index('File_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('File_tenantId_status_createdAt_idx').on(table.tenantId, table.status, table.createdAt),
    index('File_status_createdAt_idx').on(table.status, table.createdAt),
    index('File_tenantId_folderId_idx').on(table.tenantId, table.folderId),
    index('File_tenantId_isDeleted_idx').on(table.tenantId, table.isDeleted),
  ],
);

// scope: tenant
export const fileShares = pgTable(
  'FileShare',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('fileId')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tokenHash: text('tokenHash').notNull().unique(),
    passwordHash: text('passwordHash'),
    maxDownloads: integer('maxDownloads'),
    downloadCount: integer('downloadCount').notNull().default(0),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }),
    createdBy: uuid('createdBy')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('FileShare_tenantId_fileId_idx').on(table.tenantId, table.fileId),
    index('FileShare_tokenHash_idx').on(table.tokenHash),
  ],
);

// scope: tenant
export const fileVersions = pgTable(
  'FileVersion',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('fileId')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    versionNumber: integer('versionNumber').notNull(),
    key: text('key').notNull(),
    size: bigint('size', { mode: 'number' }),
    checksumSha256: text('checksumSha256'),
    createdBy: uuid('createdBy')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('FileVersion_tenantId_fileId_idx').on(table.tenantId, table.fileId),
    index('FileVersion_fileId_version_idx').on(table.fileId, table.versionNumber),
  ],
);

export type FileFolderRecord = typeof fileFolders.$inferSelect;
export type NewFileFolderRecord = typeof fileFolders.$inferInsert;
export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
export type FileShareRecord = typeof fileShares.$inferSelect;
export type NewFileShareRecord = typeof fileShares.$inferInsert;
export type FileVersionRecord = typeof fileVersions.$inferSelect;
export type NewFileVersionRecord = typeof fileVersions.$inferInsert;
