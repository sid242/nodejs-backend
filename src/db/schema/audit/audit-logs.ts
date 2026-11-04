import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actorTypeEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/index';

export const auditLogs = pgTable(
  'AuditLog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'set null' }),
    userId: uuid('userId').references(() => users.id, { onDelete: 'set null' }),
    actorType: actorTypeEnum('actorType').notNull().default('USER'),
    actorUserId: uuid('actorUserId').references(() => users.id, { onDelete: 'set null' }),
    effectiveUserId: uuid('effectiveUserId').references(() => users.id, { onDelete: 'set null' }),
    actorStaffId: uuid('actorStaffId'),
    supportSessionId: uuid('supportSessionId'),
    action: text('action').notNull(),
    source: text('source').notNull().default('DIRECT'), // DIRECT | GROUP | IMPERSONATION | SYSTEM | JOB
    result: text('result').notNull().default('SUCCESS'), // SUCCESS | FAILURE | DENIED
    entityType: text('entityType'),
    entityId: text('entityId'),
    resourceType: text('resourceType'),
    resourceId: text('resourceId'),
    requestId: text('requestId'),
    correlationId: text('correlationId'),
    reason: text('reason'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    metadata: jsonb('metadata'),
    metadataBefore: jsonb('metadataBefore'),
    metadataAfter: jsonb('metadataAfter'),
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
    index('AuditLog_tenantId_actorUserId_createdAt_idx').on(
      table.tenantId,
      table.actorUserId,
      table.createdAt,
    ),
    index('AuditLog_tenantId_effectiveUserId_createdAt_idx').on(
      table.tenantId,
      table.effectiveUserId,
      table.createdAt,
    ),
    index('AuditLog_tenantId_result_createdAt_idx').on(
      table.tenantId,
      table.result,
      table.createdAt,
    ),
    index('AuditLog_tenantId_source_createdAt_idx').on(
      table.tenantId,
      table.source,
      table.createdAt,
    ),
    index('AuditLog_tenantId_supportSessionId_idx').on(
      table.tenantId,
      table.supportSessionId,
    ),
    index('AuditLog_tenantId_entityType_entityId_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
    index('AuditLog_userId_action_idx').on(table.userId, table.action),
    index('AuditLog_requestId_idx').on(table.requestId),
    index('AuditLog_correlationId_idx').on(table.correlationId),
    index('AuditLog_createdAt_idx').on(table.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
