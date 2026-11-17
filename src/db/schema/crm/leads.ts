import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../identity/users';
import { tenantMembers, tenants } from '../tenancy/index';

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'won',
  'lost',
]);

// scope: tenant
export const leads = pgTable(
  'Lead',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    company: text('company'),
    status: leadStatusEnum('status').notNull().default('new'),
    value: integer('value').notNull().default(0), // minor units / currency cents
    departmentId: text('departmentId'), // e.g. 'sales-north', 'enterprise'
    regionId: text('regionId'), // e.g. 'apac', 'emea', 'amer'
    assignedMemberId: uuid('assignedMemberId').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    isConfidential: boolean('isConfidential').notNull().default(false),
    notes: text('notes'),
    createdBy: uuid('createdBy').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updatedBy').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Lead_tenantId_status_idx').on(table.tenantId, table.status),
    index('Lead_tenantId_assignedMemberId_idx').on(table.tenantId, table.assignedMemberId),
    index('Lead_tenantId_departmentId_idx').on(table.tenantId, table.departmentId),
    index('Lead_tenantId_createdAt_idx').on(table.tenantId, table.createdAt),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number];
