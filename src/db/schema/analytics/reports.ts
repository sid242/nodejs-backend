import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { users } from '../identity/users';

// scope: tenant
export const reportDefinitions = pgTable(
  'ReportDefinition',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'MEMBERS' | 'AUDIT' | 'USAGE' | 'FILES' | 'BILLING' | 'SECURITY'
    filters: jsonb('filters').default({}),
    columns: jsonb('columns').$type<string[]>().default([]),
    format: text('format').notNull().default('CSV'), // 'CSV' | 'JSON'
    schedule: text('schedule'), // optional cron expression
    recipients: jsonb('recipients').$type<string[]>().default([]),
    createdBy: uuid('createdBy').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('ReportDefinition_tenantId_idx').on(table.tenantId),
    index('ReportDefinition_type_idx').on(table.type),
  ],
);

export type ReportDefinition = typeof reportDefinitions.$inferSelect;
export type NewReportDefinition = typeof reportDefinitions.$inferInsert;

// scope: tenant
export const reportRuns = pgTable(
  'ReportRun',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    definitionId: uuid('definitionId')
      .notNull()
      .references(() => reportDefinitions.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
    fileKey: text('fileKey'),
    downloadUrl: text('downloadUrl'),
    rowCount: integer('rowCount').notNull().default(0),
    fileSizeBytes: integer('fileSizeBytes').notNull().default(0),
    startedAt: timestamp('startedAt', { precision: 3, mode: 'date' }),
    finishedAt: timestamp('finishedAt', { precision: 3, mode: 'date' }),
    error: text('error'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('ReportRun_tenantId_idx').on(table.tenantId),
    index('ReportRun_definitionId_idx').on(table.definitionId),
    index('ReportRun_status_idx').on(table.status),
    index('ReportRun_createdAt_idx').on(table.createdAt),
  ],
);

export type ReportRun = typeof reportRuns.$inferSelect;
export type NewReportRun = typeof reportRuns.$inferInsert;
