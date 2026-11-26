import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { whatsAppTemplateCategoryEnum, whatsAppTemplateStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';
import { whatsAppBusinessAccounts } from './accounts';

// scope: tenant
export const whatsAppTemplates = pgTable(
  'WhatsAppTemplate',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    businessAccountId: uuid('businessAccountId')
      .notNull()
      .references(() => whatsAppBusinessAccounts.id, { onDelete: 'cascade' }),
    metaTemplateId: text('metaTemplateId'),
    name: text('name').notNull(),
    category: whatsAppTemplateCategoryEnum('category').notNull(),
    language: text('language').notNull().default('en'),
    components: jsonb('components').$type<Record<string, unknown>[]>().notNull().default([]),
    requestedCategory: text('requestedCategory'),
    approvedCategory: text('approvedCategory'),
    status: whatsAppTemplateStatusEnum('status').notNull().default('DRAFT'),
    rejectionReason: text('rejectionReason'),
    qualityRating: text('qualityRating'),
    submittedAt: timestamp('submittedAt', { precision: 3, mode: 'date' }),
    approvedAt: timestamp('approvedAt', { precision: 3, mode: 'date' }),
    lastSyncedAt: timestamp('lastSyncedAt', { precision: 3, mode: 'date' }),
    createdBy: uuid('createdBy').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updatedBy').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppTemplate_tenant_waba_name_lang_idx').on(
      table.tenantId,
      table.businessAccountId,
      table.name,
      table.language,
    ),
    index('WhatsAppTemplate_tenantId_idx').on(table.tenantId),
    index('WhatsAppTemplate_businessAccountId_idx').on(table.businessAccountId),
    index('WhatsAppTemplate_status_idx').on(table.tenantId, table.status),
    index('WhatsAppTemplate_metaTemplateId_idx').on(table.metaTemplateId),
  ],
);

export type WhatsAppTemplateRecord = typeof whatsAppTemplates.$inferSelect;
export type NewWhatsAppTemplateRecord = typeof whatsAppTemplates.$inferInsert;
