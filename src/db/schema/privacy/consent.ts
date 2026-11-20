import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { consentTypeEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const consentRecords = pgTable(
  'ConsentRecord',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    type: consentTypeEnum('type').notNull(),
    version: text('version').notNull(),
    ip: text('ip'),
    userAgent: text('userAgent'),
    acceptedAt: timestamp('acceptedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('ConsentRecord_userId_idx').on(table.userId),
    index('ConsentRecord_type_idx').on(table.type),
    index('ConsentRecord_user_type_ver_idx').on(table.userId, table.type, table.version),
  ],
);

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;

// scope: primary
export const legalDocuments = pgTable(
  'LegalDocument',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: consentTypeEnum('type').notNull(),
    version: text('version').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    contentSummary: text('contentSummary'),
    isActive: boolean('isActive').notNull().default(true),
    effectiveAt: timestamp('effectiveAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('LegalDocument_type_version_idx').on(table.type, table.version),
    index('LegalDocument_type_active_idx').on(table.type, table.isActive),
  ],
);

export type LegalDocument = typeof legalDocuments.$inferSelect;
export type NewLegalDocument = typeof legalDocuments.$inferInsert;
