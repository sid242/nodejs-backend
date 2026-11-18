import { integer, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';

// scope: primary
export const invoiceSequences = pgTable(
  'InvoiceSequence',
  {
    year: integer('year').notNull(),
    nextSeq: integer('nextSeq').notNull().default(1),
    updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.year], name: 'InvoiceSequence_pkey' }),
  ],
);

export type InvoiceSequence = typeof invoiceSequences.$inferSelect;
export type NewInvoiceSequence = typeof invoiceSequences.$inferInsert;
