import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenantMembers } from '../tenancy/tenant-members';
import { tenants } from '../tenancy/tenants';

// scope: tenant
export const apiKeys = pgTable(
  'ApiKey',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(), // first 8 chars of raw random token for rapid lookup
    keyHash: text('keyHash').notNull(), // sha256 hex digest of full key
    scopes: text('scopes').array().notNull().$type<string[]>(), // permission code subset (e.g. ['files:read', 'members:read'])
    createdByMemberId: uuid('createdByMemberId').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    lastUsedAt: timestamp('lastUsedAt', { precision: 3, mode: 'date' }),
    lastUsedIp: text('lastUsedIp'),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }),
    revokedAt: timestamp('revokedAt', { precision: 3, mode: 'date' }),
    rateLimitPerMin: integer('rateLimitPerMin').notNull().default(60),
    allowedIps: text('allowedIps').array().notNull().$type<string[]>().default([]), // Optional CIDR or IP allowlist
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('ApiKey_keyHash_unique').on(table.keyHash),
    index('ApiKey_tenant_prefix_idx').on(table.tenantId, table.prefix),
    index('ApiKey_tenant_revoked_idx').on(table.tenantId, table.revokedAt),
    index('ApiKey_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);

export type ApiKeyRecord = typeof apiKeys.$inferSelect;
export type NewApiKeyRecord = typeof apiKeys.$inferInsert;
