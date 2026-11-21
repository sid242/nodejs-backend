import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';

// scope: tenant
export const activityFeed = pgTable(
  'ActivityFeed',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorId: uuid('actorId'),
    actorName: text('actorName'),
    actorAvatarUrl: text('actorAvatarUrl'),
    verb: text('verb').notNull(), // 'MEMBER_JOINED' | 'ROLE_UPDATED' | 'FILE_UPLOADED' | 'SETTINGS_CHANGED' | 'INVITATION_SENT' | 'SECURITY_ALERT'
    entityType: text('entityType').notNull(), // 'MEMBER' | 'ROLE' | 'FILE' | 'WORKSPACE' | 'BILLING' | 'SECURITY'
    entityId: text('entityId'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('ActivityFeed_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
    index('ActivityFeed_tenant_entity_idx').on(table.tenantId, table.entityType, table.createdAt),
  ],
);

export type ActivityFeedItem = typeof activityFeed.$inferSelect;
export type NewActivityFeedItem = typeof activityFeed.$inferInsert;
