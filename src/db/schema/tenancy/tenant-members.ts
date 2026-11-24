import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { membershipStatusEnum } from '../enums';
import { users } from '../identity/users';
import { tenants } from './tenants';

// scope: tenant
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

    // SCIM 2.0 & Identity synchronization
    externalId: text('externalId'),
    tokenVersion: integer('tokenVersion').notNull().default(1),
    statusChangedAt: timestamp('statusChangedAt', { precision: 3, mode: 'date' }),
    ssoBypass: boolean('ssoBypass').notNull().default(false),

    // Tenant-specific member metadata (isolated from global identity)
    memberCode: text('memberCode'),
    phone: text('phone'),
    jobTitle: text('jobTitle'),
    department: text('department'),
    departmentId: text('departmentId'),
    managerMemberId: uuid('managerMemberId'),
    location: text('location'),
    regionId: text('regionId'),
    employmentType: text('employmentType'),
    startDate: timestamp('startDate', { precision: 3, mode: 'date' }),
    endDate: timestamp('endDate', { precision: 3, mode: 'date' }),
    workEmail: text('workEmail'),
    avatarUrl: text('avatarUrl'),

    // Offboarding lifecycle
    offboardedAt: timestamp('offboardedAt', { precision: 3, mode: 'date' }),
    offboardedByMemberId: uuid('offboardedByMemberId'),
    reassignedToMemberId: uuid('reassignedToMemberId'),

    invitedAt: timestamp('invitedAt', { precision: 3, mode: 'date' }),
    joinedAt: timestamp('joinedAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    lastLoginAt: timestamp('lastLoginAt', { precision: 3, mode: 'date' }),
    deletedAt: timestamp('deletedAt', { precision: 3, mode: 'date' }),

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
    index('TenantMember_tenantId_externalId_idx').on(table.tenantId, table.externalId),
    index('TenantMember_memberCode_idx').on(table.memberCode),
    index('TenantMember_department_idx').on(table.department),
    index('TenantMember_departmentId_idx').on(table.departmentId),
    index('TenantMember_regionId_idx').on(table.regionId),
    index('TenantMember_deletedAt_idx').on(table.deletedAt),
  ],
);

export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;

export const publicTenantMember = {
  id: tenantMembers.id,
  tenantId: tenantMembers.tenantId,
  userId: tenantMembers.userId,
  status: tenantMembers.status,
  memberCode: tenantMembers.memberCode,
  phone: tenantMembers.phone,
  jobTitle: tenantMembers.jobTitle,
  department: tenantMembers.department,
  departmentId: tenantMembers.departmentId,
  managerMemberId: tenantMembers.managerMemberId,
  location: tenantMembers.location,
  regionId: tenantMembers.regionId,
  employmentType: tenantMembers.employmentType,
  startDate: tenantMembers.startDate,
  endDate: tenantMembers.endDate,
  workEmail: tenantMembers.workEmail,
  avatarUrl: tenantMembers.avatarUrl,
  offboardedAt: tenantMembers.offboardedAt,
  offboardedByMemberId: tenantMembers.offboardedByMemberId,
  reassignedToMemberId: tenantMembers.reassignedToMemberId,
  invitedAt: tenantMembers.invitedAt,
  joinedAt: tenantMembers.joinedAt,
  lastLoginAt: tenantMembers.lastLoginAt,
  createdAt: tenantMembers.createdAt,
};
