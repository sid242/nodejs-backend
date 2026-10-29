import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import {
  supportSessionModeEnum,
  supportSessionScopeEnum,
  supportSessionStatusEnum,
} from '../enums';
import { tenantMembers, tenants } from '../tenants/index';
import { users } from '../identity/users';
import { platformStaff } from './platform-staff';

export const platformSupportSessions = pgTable(
  'PlatformSupportSession',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => platformStaff.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    mode: supportSessionModeEnum('mode').notNull().default('TENANT_SCOPED'),
    scope: supportSessionScopeEnum('scope').notNull().default('READ_ONLY'),
    targetUserId: uuid('targetUserId').references(() => users.id, {
      onDelete: 'set null',
    }),
    targetMemberId: uuid('targetMemberId').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    ticketRef: text('ticketRef'),
    reason: text('reason').notNull(),
    status: supportSessionStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    startedAt: timestamp('startedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    endedAt: timestamp('endedAt', { precision: 3, mode: 'date' }),
    endedByStaffId: uuid('endedByStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    endOutcome: text('endOutcome'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('PlatformSupportSession_staffId_status_idx').on(table.staffId, table.status),
    index('PlatformSupportSession_tenantId_status_idx').on(table.tenantId, table.status),
    index('PlatformSupportSession_targetUserId_idx').on(table.targetUserId),
    index('PlatformSupportSession_targetMemberId_idx').on(table.targetMemberId),
  ],
);

export type PlatformSupportSession = typeof platformSupportSessions.$inferSelect;
export type NewPlatformSupportSession = typeof platformSupportSessions.$inferInsert;

export const publicPlatformSupportSession = {
  id: platformSupportSessions.id,
  staffId: platformSupportSessions.staffId,
  tenantId: platformSupportSessions.tenantId,
  mode: platformSupportSessions.mode,
  scope: platformSupportSessions.scope,
  targetUserId: platformSupportSessions.targetUserId,
  targetMemberId: platformSupportSessions.targetMemberId,
  ticketRef: platformSupportSessions.ticketRef,
  reason: platformSupportSessions.reason,
  status: platformSupportSessions.status,
  expiresAt: platformSupportSessions.expiresAt,
  startedAt: platformSupportSessions.startedAt,
  endedAt: platformSupportSessions.endedAt,
  createdAt: platformSupportSessions.createdAt,
};
