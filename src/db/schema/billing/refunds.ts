import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from '../tenancy/tenants';
import { payments } from './payments';

/**
 * Refund records for processed payment refunds.
 * All amounts are stored in minor currency units (paise for INR, cents for USD).
 */
export const refunds = pgTable(
  'Refund',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: uuid('paymentId')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().default('razorpay'),
    providerRefundId: text('providerRefundId'), // Razorpay Refund ID (rfnd_xxx)
    amountMinor: integer('amountMinor').notNull(), // Refund amount in paise / cents
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('INITIATED'),
    // 'INITIATED' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
    reason: text('reason'),
    requestedBy: text('requestedBy').notNull(), // Staff ID who requested the refund
    processedAt: timestamp('processedAt', { precision: 3, mode: 'date' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Refund_providerRefundId_unique').on(table.providerRefundId),
    index('Refund_tenantId_idx').on(table.tenantId),
    index('Refund_paymentId_idx').on(table.paymentId),
    index('Refund_status_idx').on(table.status),
    index('Refund_createdAt_idx').on(table.createdAt),
  ],
);

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
