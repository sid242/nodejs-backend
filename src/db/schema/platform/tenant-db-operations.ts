import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { platformStaff } from './platform-staff';

// scope: primary
export const tenantDbOperations = pgTable(
  'TenantDbOperation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'PROVISION' | 'MIGRATE_SCHEMA' | 'SWITCH_TO_DEDICATED' | 'ROLLBACK_TO_SHARED' | 'BACKUP' | 'RESTORE' | 'VERIFY' | 'HEALTH_CHECK'
    status: text('status').notNull().default('QUEUED'), // 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
    requestedByStaffId: uuid('requestedByStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    approvedByStaffId: uuid('approvedByStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    params: jsonb('params'),
    progress: jsonb('progress'), // { currentStep: string, tables?: Record<string, { copied: number; total: number }>, percent?: number }
    error: text('error'),
    startedAt: timestamp('startedAt', { precision: 3, mode: 'date' }),
    finishedAt: timestamp('finishedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('TenantDbOperation_tenantId_idx').on(table.tenantId),
    index('TenantDbOperation_kind_idx').on(table.kind),
    index('TenantDbOperation_status_idx').on(table.status),
    index('TenantDbOperation_createdAt_idx').on(table.createdAt),
  ],
);

export type TenantDbOperation = typeof tenantDbOperations.$inferSelect;
export type NewTenantDbOperation = typeof tenantDbOperations.$inferInsert;
