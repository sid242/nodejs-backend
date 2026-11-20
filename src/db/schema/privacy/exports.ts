import { integer, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { dataExportScopeEnum, dataExportStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const dataExportRequests = pgTable(
  'DataExportRequest',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    scope: dataExportScopeEnum('scope').notNull().default('USER'),
    status: dataExportStatusEnum('status').notNull().default('PENDING'),
    fileKey: text('fileKey'),
    downloadUrl: text('downloadUrl'),
    fileSizeBytes: integer('fileSizeBytes'),
    errorMessage: text('errorMessage'),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completedAt', { precision: 3, mode: 'date' }),
  },
  (table) => [
    index('DataExportRequest_userId_idx').on(table.userId),
    index('DataExportRequest_tenantId_idx').on(table.tenantId),
    index('DataExportRequest_status_idx').on(table.status),
    index('DataExportRequest_createdAt_idx').on(table.createdAt),
  ],
);

export type DataExportRequest = typeof dataExportRequests.$inferSelect;
export type NewDataExportRequest = typeof dataExportRequests.$inferInsert;
