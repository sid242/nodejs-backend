import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { emailTemplateCategoryEnum, emailTemplateStatusEnum } from './enums.js';
import { tenants } from './tenants/index.js';
import { users } from './users.js';

export const emailTemplates = pgTable(
  'EmailTemplate',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    subject: text('subject').notNull(),
    category: emailTemplateCategoryEnum('category').notNull().default('CUSTOM'),
    status: emailTemplateStatusEnum('status').notNull().default('DRAFT'),
    description: text('description'),
    senderName: text('senderName'),
    fromEmail: text('fromEmail'),
    replyTo: text('replyTo'),
    htmlContent: text('htmlContent').notNull(),
    designJson: jsonb('designJson'),
    variables: jsonb('variables').$type<string[]>().notNull().default([]),
    createdById: uuid('createdById').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('EmailTemplate_tenantId_slug_unique').on(table.tenantId, table.slug),
    index('EmailTemplate_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('EmailTemplate_tenantId_status_createdAt_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    index('EmailTemplate_tenantId_category_createdAt_idx').on(
      table.tenantId,
      table.category,
      table.createdAt,
    ),
  ],
);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
