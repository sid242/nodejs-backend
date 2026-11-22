import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { platformStaff } from '../platform/platform-staff';
import { tenants } from '../tenancy/tenants';

// scope: primary
export const maintenanceConfig = pgTable(
  'MaintenanceConfig',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: text('scope').notNull().default('GLOBAL'), // 'GLOBAL' or tenantId
    tenantId: uuid('tenantId').references(() => tenants.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    readOnly: boolean('readOnly').notNull().default(false),
    message: text('message'),
    startsAt: timestamp('startsAt', { precision: 3, mode: 'date' }),
    endsAt: timestamp('endsAt', { precision: 3, mode: 'date' }),
    allowStaff: boolean('allowStaff').notNull().default(true),
    updatedByStaffId: uuid('updatedByStaffId').references(() => platformStaff.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('MaintenanceConfig_scope_enabled_idx').on(table.scope, table.enabled),
    index('MaintenanceConfig_tenantId_idx').on(table.tenantId),
  ],
);

export type MaintenanceConfig = typeof maintenanceConfig.$inferSelect;
export type NewMaintenanceConfig = typeof maintenanceConfig.$inferInsert;
