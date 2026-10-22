import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { platformStaff } from './platform-staff.js';

export const platformAuditLogs = pgTable(
  'PlatformAuditLog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorStaffId: uuid('actorStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('targetType').notNull(), // e.g. 'staff', 'role', 'tenant', 'billing'
    targetId: text('targetId'),
    tenantId: uuid('tenantId'), // nullable: populated when action targets a specific tenant
    metadata: jsonb('metadata'), // allow-listed fields only
    requestId: text('requestId'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('PlatformAuditLog_actorStaffId_idx').on(table.actorStaffId),
    index('PlatformAuditLog_action_idx').on(table.action),
    index('PlatformAuditLog_targetType_idx').on(table.targetType),
    index('PlatformAuditLog_tenantId_idx').on(table.tenantId),
    index('PlatformAuditLog_createdAt_idx').on(table.createdAt),
  ],
);

export type PlatformAuditLog = typeof platformAuditLogs.$inferSelect;
export type NewPlatformAuditLog = typeof platformAuditLogs.$inferInsert;
