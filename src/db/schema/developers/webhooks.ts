import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenantMembers } from '../tenancy/tenant-members';
import { tenants } from '../tenancy/tenants';

// scope: tenant
export const webhookEndpoints = pgTable(
  'WebhookEndpoint',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(), // HTTPS webhook callback URL
    description: text('description'),
    secretEncrypted: text('secretEncrypted').notNull(), // Master-encrypted HMAC signing secret (whsec_...)
    events: text('events')
      .array()
      .notNull()
      .$type<string[]>(), // e.g. ['member.created', 'file.uploaded', 'invitation.accepted']
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'DISABLED' | 'FAILING'
    createdByMemberId: uuid('createdByMemberId').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('WebhookEndpoint_tenant_status_idx').on(table.tenantId, table.status),
    index('WebhookEndpoint_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);

export type WebhookEndpointRecord = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpointRecord = typeof webhookEndpoints.$inferInsert;

// scope: tenant
export const webhookDeliveries = pgTable(
  'WebhookDelivery',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    endpointId: uuid('endpointId')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: text('eventId').notNull(),
    eventType: text('eventType').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('PENDING'), // 'PENDING' | 'SUCCESS' | 'FAILED'
    attempt: integer('attempt').notNull().default(1),
    responseStatus: integer('responseStatus'),
    responseBodySnippet: text('responseBodySnippet'),
    durationMs: integer('durationMs'),
    nextAttemptAt: timestamp('nextAttemptAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('WebhookDelivery_endpoint_created_idx').on(table.endpointId, table.createdAt),
    index('WebhookDelivery_tenant_status_idx').on(table.tenantId, table.status),
    index('WebhookDelivery_tenant_event_idx').on(table.tenantId, table.eventId),
  ],
);

export type WebhookDeliveryRecord = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRecord = typeof webhookDeliveries.$inferInsert;
