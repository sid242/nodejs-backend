import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { whatsAppConsentPurposeEnum, whatsAppConsentStatusEnum } from '../enums';
import { tenants } from '../tenancy/tenants';
import { whatsAppContacts } from './contacts';

// scope: tenant
export const whatsAppContactConsents = pgTable(
  'WhatsAppContactConsent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contactId')
      .notNull()
      .references(() => whatsAppContacts.id, { onDelete: 'cascade' }),
    purpose: whatsAppConsentPurposeEnum('purpose').notNull(),
    status: whatsAppConsentStatusEnum('status').notNull().default('OPTED_IN'),
    consentSource: text('consentSource').notNull().default('DIRECT'),
    policyVersion: text('policyVersion').default('v1.0'),
    consentedAt: timestamp('consentedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revokedAt', { precision: 3, mode: 'date' }),
    evidenceReference: text('evidenceReference'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppContactConsent_contact_purpose_idx').on(
      table.tenantId,
      table.contactId,
      table.purpose,
    ),
    index('WhatsAppContactConsent_tenantId_idx').on(table.tenantId),
    index('WhatsAppContactConsent_contactId_idx').on(table.contactId),
  ],
);

export type WhatsAppContactConsentRecord = typeof whatsAppContactConsents.$inferSelect;
export type NewWhatsAppContactConsentRecord = typeof whatsAppContactConsents.$inferInsert;
