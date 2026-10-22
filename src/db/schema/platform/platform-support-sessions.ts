import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { platformStaff } from './platform-staff.js';

export const platformSupportSessions = pgTable(
  'PlatformSupportSession',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    staffId: uuid('staffId')
      .notNull()
      .references(() => platformStaff.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').notNull(),
    targetUserId: uuid('targetUserId'), // optional target customer user being impersonated
    impersonatedRole: text('impersonatedRole'), // snapshot of assigned role during support session
    reason: text('reason').notNull(), // ticket reference or support reason
    status: text('status').notNull().default('ACTIVE'), // ACTIVE, EXPIRED, TERMINATED
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    startedAt: timestamp('startedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    endedAt: timestamp('endedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('PlatformSupportSession_staffId_idx').on(table.staffId),
    index('PlatformSupportSession_tenantId_idx').on(table.tenantId),
    index('PlatformSupportSession_targetUserId_idx').on(table.targetUserId),
    index('PlatformSupportSession_status_idx').on(table.status),
  ],
);

export type PlatformSupportSession = typeof platformSupportSessions.$inferSelect;
export type NewPlatformSupportSession = typeof platformSupportSessions.$inferInsert;
