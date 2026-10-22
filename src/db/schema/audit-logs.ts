import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants';
import { users } from './users';

export const auditLogs = pgTable(
  'AuditLog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'set null' }),
    userId: uuid('userId').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entityType'),
    entityId: text('entityId'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('AuditLog_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('AuditLog_tenantId_action_idx').on(table.tenantId, table.action),
    index('AuditLog_tenantId_userId_createdAt_idx').on(
      table.tenantId,
      table.userId,
      table.createdAt,
    ),
    index('AuditLog_tenantId_entityType_entityId_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
    index('AuditLog_userId_action_idx').on(table.userId, table.action),
    index('AuditLog_createdAt_idx').on(table.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
