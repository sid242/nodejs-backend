import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from '../identity/users';
import { tenants } from '../tenancy/tenants';

export const tenantAuditPolicies = pgTable(
  'TenantAuditPolicy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    retentionDays: integer('retentionDays').notNull().default(90),
    exportAllowed: boolean('exportAllowed').notNull().default(true),
    complianceFramework: text('complianceFramework').notNull().default('SOC2'), // SOC2 | HIPAA | GDPR | ISO27001 | CUSTOM
    lastArchivedAt: timestamp('lastArchivedAt', { precision: 3, mode: 'date' }),
    updatedBy: uuid('updatedBy').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('TenantAuditPolicy_tenantId_idx').on(table.tenantId),
  ],
);

export const tenantAuditPoliciesRelations = relations(tenantAuditPolicies, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantAuditPolicies.tenantId],
    references: [tenants.id],
  }),
  updater: one(users, {
    fields: [tenantAuditPolicies.updatedBy],
    references: [users.id],
  }),
}));

export type TenantAuditPolicy = typeof tenantAuditPolicies.$inferSelect;
export type NewTenantAuditPolicy = typeof tenantAuditPolicies.$inferInsert;

