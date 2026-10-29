import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { invitationStatusEnum } from '../enums';
import { platformStaff } from '../platform/platform-staff';
import { roles } from '../rbac';
import { users } from '../users';
import { tenants } from './tenants';

export const tenantInvitations = pgTable(
  'TenantInvitation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    roleId: uuid('roleId')
      .notNull()
      .references(() => roles.id),
    invitedByUserId: uuid('invitedByUserId').references(() => users.id, {
      onDelete: 'set null',
    }),
    invitedByStaffId: uuid('invitedByStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    tokenHash: text('tokenHash').notNull().unique(),
    status: invitationStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expiresAt', { precision: 3, mode: 'date' }).notNull(),
    acceptedAt: timestamp('acceptedAt', { precision: 3, mode: 'date' }),
    acceptedByUserId: uuid('acceptedByUserId').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revokedAt', { precision: 3, mode: 'date' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('TenantInvitation_tenantId_email_pending_unique')
      .on(table.tenantId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'PENDING'`),
    index('TenantInvitation_tenantId_status_idx').on(table.tenantId, table.status),
    index('TenantInvitation_email_idx').on(table.email),
    index('TenantInvitation_tokenHash_idx').on(table.tokenHash),
  ],
);

export type TenantInvitation = typeof tenantInvitations.$inferSelect;
export type NewTenantInvitation = typeof tenantInvitations.$inferInsert;

export const publicTenantInvitation = {
  id: tenantInvitations.id,
  tenantId: tenantInvitations.tenantId,
  email: tenantInvitations.email,
  roleId: tenantInvitations.roleId,
  status: tenantInvitations.status,
  expiresAt: tenantInvitations.expiresAt,
  createdAt: tenantInvitations.createdAt,
};
