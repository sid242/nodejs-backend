import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const auditRetentionRuns = pgTable('AuditRetentionRun', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
  cutoffDate: timestamp('cutoffDate', { precision: 3, mode: 'date' }).notNull(),
  rowsArchived: integer('rowsArchived').notNull().default(0),
  rowsPurged: integer('rowsPurged').notNull().default(0),
  archiveS3Key: text('archiveS3Key'),
  archiveSha256: text('archiveSha256'),
  status: text('status').notNull().default('PENDING'), // PENDING | COMPLETED | FAILED
  error: text('error'),
  startedAt: timestamp('startedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  completedAt: timestamp('completedAt', { precision: 3, mode: 'date' }),
});

export type AuditRetentionRun = typeof auditRetentionRuns.$inferSelect;
export type NewAuditRetentionRun = typeof auditRetentionRuns.$inferInsert;
