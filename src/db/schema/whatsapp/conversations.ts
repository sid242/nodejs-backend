import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { whatsAppConversationStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';
import { whatsAppContacts } from './contacts';

// scope: tenant
export const whatsAppConversations = pgTable(
  'WhatsAppConversation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phoneNumberId').notNull(),
    contactId: uuid('contactId')
      .notNull()
      .references(() => whatsAppContacts.id, { onDelete: 'cascade' }),
    assignedStaffId: uuid('assignedStaffId').references(() => users.id, { onDelete: 'set null' }),
    status: whatsAppConversationStatusEnum('status').notNull().default('OPEN'),
    lastInboundMessageAt: timestamp('lastInboundMessageAt', { precision: 3, mode: 'date' }),
    customerServiceWindowExpiresAt: timestamp('customerServiceWindowExpiresAt', {
      precision: 3,
      mode: 'date',
    }),
    lastMessageAt: timestamp('lastMessageAt', { precision: 3, mode: 'date' }),
    unreadCount: integer('unreadCount').notNull().default(0),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('WhatsAppConversation_tenant_phone_contact_idx').on(
      table.tenantId,
      table.phoneNumberId,
      table.contactId,
    ),
    index('WhatsAppConversation_tenantId_idx').on(table.tenantId),
    index('WhatsAppConversation_contactId_idx').on(table.contactId),
    index('WhatsAppConversation_status_idx').on(table.tenantId, table.status),
    index('WhatsAppConversation_lastMessageAt_idx').on(table.tenantId, table.lastMessageAt),
  ],
);

export type WhatsAppConversationRecord = typeof whatsAppConversations.$inferSelect;
export type NewWhatsAppConversationRecord = typeof whatsAppConversations.$inferInsert;
