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

import { users } from '../identity/users';
import { platformStaff } from '../platform/platform-staff';
import { tenants } from '../tenancy/tenants';

// -----------------------------------------------------------------------------
// Onboarding Progress (scope: tenant)
// -----------------------------------------------------------------------------
// scope: tenant
export const onboardingProgress = pgTable(
  'OnboardingProgress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('userId').references(() => users.id, { onDelete: 'set null' }),
    stepKey: text('stepKey').notNull(),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'COMPLETED' | 'SKIPPED'
    completedAt: timestamp('completedAt', { precision: 3, mode: 'date' }),
    data: jsonb('data').default({}),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('OnboardingProgress_tenantId_stepKey_key').on(table.tenantId, table.stepKey),
    index('OnboardingProgress_tenantId_status_idx').on(table.tenantId, table.status),
  ],
);

// -----------------------------------------------------------------------------
// Support Tickets (scope: tenant)
// -----------------------------------------------------------------------------
// scope: tenant
export const supportTickets = pgTable(
  'SupportTicket',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticketRef: text('ticketRef').notNull(),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    priority: text('priority').notNull().default('MEDIUM'), // 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    status: text('status').notNull().default('OPEN'), // 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED'
    category: text('category').notNull().default('GENERAL'), // 'GENERAL' | 'BILLING' | 'TECHNICAL' | 'SECURITY'
    assigneeStaffId: uuid('assigneeStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').default({}),
    resolvedAt: timestamp('resolvedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('SupportTicket_ticketRef_key').on(table.ticketRef),
    index('SupportTicket_tenantId_status_idx').on(table.tenantId, table.status),
    index('SupportTicket_userId_idx').on(table.userId),
    index('SupportTicket_assigneeStaffId_idx').on(table.assigneeStaffId),
  ],
);

// -----------------------------------------------------------------------------
// Support Ticket Messages / Conversation (scope: tenant)
// -----------------------------------------------------------------------------
// scope: tenant
export const supportTicketMessages = pgTable(
  'SupportTicketMessage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticketId')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    senderType: text('senderType').notNull().default('USER'), // 'USER' | 'STAFF' | 'SYSTEM'
    senderId: uuid('senderId').notNull(),
    senderName: text('senderName'),
    message: text('message').notNull(),
    attachments: jsonb('attachments').default([]),
    isInternal: boolean('isInternal').notNull().default(false),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('SupportTicketMessage_ticketId_createdAt_idx').on(table.ticketId, table.createdAt),
    index('SupportTicketMessage_tenantId_idx').on(table.tenantId),
  ],
);

// -----------------------------------------------------------------------------
// User Feedback Items (scope: primary)
// -----------------------------------------------------------------------------
// scope: primary
export const feedbackItems = pgTable(
  'FeedbackItem',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'set null' }),
    userId: uuid('userId').references(() => users.id, { onDelete: 'set null' }),
    rating: integer('rating').notNull(), // 1 to 5
    category: text('category').notNull().default('GENERAL'), // 'GENERAL' | 'BUG' | 'FEATURE' | 'UI'
    comment: text('comment').notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('FeedbackItem_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('FeedbackItem_rating_idx').on(table.rating),
  ],
);
