import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  emailDeliveryStatusEnum,
  emailSuppressionReasonEnum,
  emailTemplateCategoryEnum,
  emailTemplateStatusEnum,
} from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/index';

// scope: tenant
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
    locale: text('locale').notNull().default('en'),
    currentVersion: integer('currentVersion').notNull().default(1),
    isSystemOverride: boolean('isSystemOverride').notNull().default(false),
    lastPublishedAt: timestamp('lastPublishedAt', { precision: 3, mode: 'date' }),
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
    uniqueIndex('EmailTemplate_tenantId_slug_locale_unique').on(
      table.tenantId,
      table.slug,
      table.locale,
    ),
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

// scope: tenant
export const emailTemplateVersions = pgTable(
  'EmailTemplateVersion',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('templateId')
      .notNull()
      .references(() => emailTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    subject: text('subject').notNull(),
    htmlContent: text('htmlContent').notNull(),
    designJson: jsonb('designJson'),
    variables: jsonb('variables').$type<string[]>().notNull().default([]),
    createdById: uuid('createdById').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('EmailTemplateVersion_tenantId_templateId_version_unique').on(
      table.tenantId,
      table.templateId,
      table.version,
    ),
    index('EmailTemplateVersion_tenantId_templateId_createdAt_idx').on(
      table.tenantId,
      table.templateId,
      table.createdAt,
    ),
  ],
);

export type EmailTemplateVersion = typeof emailTemplateVersions.$inferSelect;
export type NewEmailTemplateVersion = typeof emailTemplateVersions.$inferInsert;

// scope: tenant
export const emailMessages = pgTable(
  'EmailMessage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('templateId').references(() => emailTemplates.id, { onDelete: 'set null' }),
    templateSlug: text('templateSlug'),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    status: emailDeliveryStatusEnum('status').notNull().default('QUEUED'),
    provider: text('provider'),
    providerMessageId: text('providerMessageId'),
    attempts: integer('attempts').notNull().default(1),
    lastError: text('lastError'),
    sentAt: timestamp('sentAt', { precision: 3, mode: 'date' }),
    deliveredAt: timestamp('deliveredAt', { precision: 3, mode: 'date' }),
    openedAt: timestamp('openedAt', { precision: 3, mode: 'date' }),
    relatedEntityType: text('relatedEntityType'),
    relatedEntityId: text('relatedEntityId'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('EmailMessage_tenantId_status_createdAt_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    index('EmailMessage_tenantId_to_idx').on(table.tenantId, table.to),
    index('EmailMessage_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
  ],
);

export type EmailMessage = typeof emailMessages.$inferSelect;
export type NewEmailMessage = typeof emailMessages.$inferInsert;

// scope: tenant
export const emailSuppressions = pgTable(
  'EmailSuppression',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    reason: emailSuppressionReasonEnum('reason').notNull().default('BOUNCE'),
    details: text('details'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('EmailSuppression_tenantId_email_unique').on(table.tenantId, table.email),
    index('EmailSuppression_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
  ],
);

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;
