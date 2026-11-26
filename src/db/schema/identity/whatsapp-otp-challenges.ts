import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { whatsAppOtpPurposeEnum } from '../enums';

// scope: primary
export const whatsAppOtpChallenges = pgTable(
  'WhatsAppOtpChallenge',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phoneNumber: text('phoneNumber').notNull(),
    purpose: whatsAppOtpPurposeEnum('purpose').notNull(),
    codeHash: text('codeHash').notNull(),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    attemptCount: integer('attemptCount').notNull().default(0),
    maxAttempts: integer('maxAttempts').notNull().default(5),
    consumedAt: timestamp('consumedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('WhatsAppOtp_phone_purpose_created_idx').on(
      table.phoneNumber,
      table.purpose,
      table.createdAt,
    ),
    index('WhatsAppOtp_expiresAt_idx').on(table.expiresAt),
  ],
);

export type WhatsAppOtpChallengeRecord = typeof whatsAppOtpChallenges.$inferSelect;
export type NewWhatsAppOtpChallengeRecord = typeof whatsAppOtpChallenges.$inferInsert;
