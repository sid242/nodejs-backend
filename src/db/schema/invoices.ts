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

import { plans } from './plans';
import { subscriptions } from './subscriptions';
import { tenants } from './tenants/tenants';

export const invoices = pgTable(
  'Invoice',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscriptionId').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    planId: uuid('planId').references(() => plans.id, { onDelete: 'set null' }),
    invoiceNumber: text('invoiceNumber').notNull(),
    status: text('status').notNull().default('DRAFT'), // 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE'
    amountCents: integer('amountCents').notNull().default(0),
    taxCents: integer('taxCents').notNull().default(0),
    totalCents: integer('totalCents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    lineItems: jsonb('lineItems')
      .$type<
        Array<{
          description: string;
          quantity: number;
          unitPriceCents: number;
          totalCents: number;
        }>
      >()
      .default([]),
    billingPeriodStart: timestamp('billingPeriodStart', { precision: 3, mode: 'date' }),
    billingPeriodEnd: timestamp('billingPeriodEnd', { precision: 3, mode: 'date' }),
    dueDate: timestamp('dueDate', { precision: 3, mode: 'date' }),
    paidAt: timestamp('paidAt', { precision: 3, mode: 'date' }),
    pdfUrl: text('pdfUrl'),
    providerInvoiceId: text('providerInvoiceId'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { precision: 3, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('Invoice_invoiceNumber_unique').on(table.invoiceNumber),
    index('Invoice_tenantId_idx').on(table.tenantId),
    index('Invoice_subscriptionId_idx').on(table.subscriptionId),
    index('Invoice_status_idx').on(table.status),
    index('Invoice_createdAt_idx').on(table.createdAt),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

export const publicInvoice = {
  id: invoices.id,
  tenantId: invoices.tenantId,
  subscriptionId: invoices.subscriptionId,
  planId: invoices.planId,
  invoiceNumber: invoices.invoiceNumber,
  status: invoices.status,
  amountCents: invoices.amountCents,
  taxCents: invoices.taxCents,
  totalCents: invoices.totalCents,
  currency: invoices.currency,
  lineItems: invoices.lineItems,
  billingPeriodStart: invoices.billingPeriodStart,
  billingPeriodEnd: invoices.billingPeriodEnd,
  dueDate: invoices.dueDate,
  paidAt: invoices.paidAt,
  pdfUrl: invoices.pdfUrl,
  createdAt: invoices.createdAt,
};
