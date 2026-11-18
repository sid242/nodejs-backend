import { desc } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { users } from './users';

// scope: primary
export const userLoginEvents = pgTable(
  'UserLoginEvent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId').references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'set null' }),
    result: text('result').notNull(), // 'SUCCESS' | 'FAILED' | 'LOCKED' | 'MFA_FAILED'
    method: text('method').notNull(), // 'PASSWORD' | 'MAGIC' | 'SSO' | 'HANDOFF' | 'RECOVERY_CODE'
    ip: text('ip'),
    userAgent: text('userAgent'),
    country: text('country'),
    city: text('city'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('UserLoginEvent_userId_createdAt_idx').on(table.userId, desc(table.createdAt)),
    index('UserLoginEvent_tenantId_createdAt_idx').on(table.tenantId, desc(table.createdAt)),
  ],
);

export type UserLoginEvent = typeof userLoginEvents.$inferSelect;
export type NewUserLoginEvent = typeof userLoginEvents.$inferInsert;
