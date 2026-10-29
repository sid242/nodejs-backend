import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { verificationTokenTypeEnum } from '../enums';
import { users } from './users';

export const verificationTokens = pgTable(
  'VerificationToken',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('tokenHash').notNull().unique(),
    type: verificationTokenTypeEnum('type').notNull(),
    target: text('target'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('maxAttempts').notNull().default(5),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    usedAt: timestamp('usedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('VerificationToken_userId_type_idx').on(table.userId, table.type),
    index('VerificationToken_expiresAt_idx').on(table.expiresAt),
  ],
);

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;
