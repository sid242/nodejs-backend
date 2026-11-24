import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { accountDeletionStatusEnum } from '../enums';
import { users } from '../identity/users';
import { platformStaff } from '../platform/platform-staff';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const accountDeletionRequests = pgTable(
  'AccountDeletionRequest',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: accountDeletionStatusEnum('status').notNull().default('COOLING_PERIOD'),
    reason: text('reason'),
    cancellationSecretHash: text('cancellationSecretHash'),
    graceEndsAt: timestamp('graceEndsAt', { precision: 3, mode: 'date' }).notNull(),
    requestedAt: timestamp('requestedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completedAt', { precision: 3, mode: 'date' }),
    canceledAt: timestamp('canceledAt', { precision: 3, mode: 'date' }),
  },
  (table) => [
    index('AccountDeletionRequest_userId_idx').on(table.userId),
    index('AccountDeletionRequest_status_idx').on(table.status),
    index('AccountDeletionRequest_graceEndsAt_idx').on(table.graceEndsAt),
  ],
);

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type NewAccountDeletionRequest = typeof accountDeletionRequests.$inferInsert;

// scope: primary
export const tenantTombstones = pgTable(
  'TenantTombstone',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    reason: text('reason').notNull().default('REQUESTED_BY_OWNER'),
    closedAt: timestamp('closedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    purgedAt: timestamp('purgedAt', { precision: 3, mode: 'date' }),
    closedByUserId: uuid('closedByUserId'),
  },
  (table) => [
    uniqueIndex('TenantTombstone_slug_idx').on(table.slug),
    index('TenantTombstone_tenantId_idx').on(table.tenantId),
    index('TenantTombstone_closedAt_idx').on(table.closedAt),
  ],
);

export type TenantTombstone = typeof tenantTombstones.$inferSelect;
export type NewTenantTombstone = typeof tenantTombstones.$inferInsert;

// scope: primary
export const tenantLegalHolds = pgTable(
  'TenantLegalHold',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    placedByStaffId: uuid('placedByStaffId')
      .notNull()
      .references(() => platformStaff.id),
    placedAt: timestamp('placedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    releasedAt: timestamp('releasedAt', { precision: 3, mode: 'date' }),
    releasedByStaffId: uuid('releasedByStaffId').references(() => platformStaff.id),
    releaseReason: text('releaseReason'),
  },
  (table) => [
    index('TenantLegalHold_tenantId_idx').on(table.tenantId),
    index('TenantLegalHold_releasedAt_idx').on(table.releasedAt),
  ],
);

export type TenantLegalHold = typeof tenantLegalHolds.$inferSelect;
export type NewTenantLegalHold = typeof tenantLegalHolds.$inferInsert;
