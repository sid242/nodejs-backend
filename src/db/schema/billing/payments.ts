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
import { subscriptions } from './subscriptions';

/**
 * Payment records for tenant billing transactions.
 * Stores both one-time purchases and subscription renewal payments.
 * All amounts are stored in minor currency units (paise for INR, cents for USD).
 */
export const payments = pgTable(
  'Payment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscriptionId').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull().default('razorpay'), // 'razorpay' | 'manual'
    providerOrderId: text('providerOrderId'), // Razorpay Order ID (order_xxx)
    providerPaymentId: text('providerPaymentId'), // Razorpay Payment ID (pay_xxx)
    providerInvoiceId: text('providerInvoiceId'), // Razorpay Invoice ID (inv_xxx)
    providerSignature: text('providerSignature'), // Razorpay signature for verification audit
    amountMinor: integer('amountMinor').notNull(), // Amount in paise / cents
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('CREATED'),
    // 'CREATED' | 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'
    paymentMethod: text('paymentMethod'), // 'card', 'upi', 'netbanking', 'wallet', etc.
    failureCode: text('failureCode'),
    failureDescription: text('failureDescription'),
    paidAt: timestamp('paidAt', { precision: 3, mode: 'date' }),
    metadata: jsonb('metadata'), // Additional data (plan snapshot, billing identity, etc.)
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Payment_providerOrderId_unique').on(table.providerOrderId),
    index('Payment_tenantId_idx').on(table.tenantId),
    index('Payment_subscriptionId_idx').on(table.subscriptionId),
    index('Payment_status_idx').on(table.status),
    index('Payment_providerPaymentId_idx').on(table.providerPaymentId),
    index('Payment_createdAt_idx').on(table.createdAt),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export const publicPayment = {
  id: payments.id,
  tenantId: payments.tenantId,
  subscriptionId: payments.subscriptionId,
  provider: payments.provider,
  amountMinor: payments.amountMinor,
  currency: payments.currency,
  status: payments.status,
  paymentMethod: payments.paymentMethod,
  paidAt: payments.paidAt,
  createdAt: payments.createdAt,
};
