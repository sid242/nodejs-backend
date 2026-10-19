import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const sessions = pgTable(
  'Session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refreshTokenHash').notNull().unique(),
    userAgent: text('userAgent'),
    ipAddress: text('ipAddress'),
    deviceType: text('deviceType'),
    isRevoked: boolean('isRevoked').notNull().default(false),
    lastActiveAt: timestamp('lastActiveAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('Session_userId_isRevoked_idx').on(table.userId, table.isRevoked),
    index('Session_expiresAt_idx').on(table.expiresAt),
  ],
);

export type SessionRecord = typeof sessions.$inferSelect;
export type NewSessionRecord = typeof sessions.$inferInsert;
