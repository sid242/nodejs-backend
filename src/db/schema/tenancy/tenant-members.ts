import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { membershipStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from './tenants';

export const tenantMembers = pgTable(
  'TenantMember',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: membershipStatusEnum('status').notNull().default('ACTIVE'),
    joinedAt: timestamp('joinedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('TenantMember_tenantId_userId_unique').on(table.tenantId, table.userId),
    index('TenantMember_userId_status_idx').on(table.userId, table.status),
    index('TenantMember_tenantId_status_idx').on(table.tenantId, table.status),
    index('TenantMember_tenantId_status_createdAt_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
  ],
);

export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
