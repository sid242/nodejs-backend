import { and, count, desc, eq, SQL } from 'drizzle-orm';

import { db } from '@/config/db.js';
import { invoices, plans, tenants, type Invoice, type NewInvoice } from '@/db/schema/index.js';

export interface InvoiceWithDetails extends Invoice {
  tenantName?: string;
  planName?: string | null;
}

export async function generateInvoiceNumber(): Promise<string> {
  const currentYear = new Date().getFullYear();
  const [result] = await db.select({ total: count() }).from(invoices);
  const sequence = (Number(result?.total ?? 0) + 1).toString().padStart(5, '0');
  return `INV-${currentYear}-${sequence}`;
}

export async function createInvoice(
  data: Omit<NewInvoice, 'id' | 'invoiceNumber' | 'totalCents' | 'createdAt' | 'updatedAt'> & {
    invoiceNumber?: string;
  },
): Promise<Invoice> {
  const invoiceNumber = data.invoiceNumber ?? (await generateInvoiceNumber());
  const amountCents = Number(data.amountCents ?? 0);
  const taxCents = Number(data.taxCents ?? 0);
  const totalCents = amountCents + taxCents;

  const [record] = await db
    .insert(invoices)
    .values({
      ...data,
      invoiceNumber,
      amountCents,
      taxCents,
      totalCents,
    })
    .returning();

  return record!;
}

export async function findInvoiceById(id: string): Promise<InvoiceWithDetails | null> {
  const [row] = await db
    .select({
      invoice: invoices,
      tenantName: tenants.name,
      planName: plans.name,
    })
    .from(invoices)
    .innerJoin(tenants, eq(invoices.tenantId, tenants.id))
    .leftJoin(plans, eq(invoices.planId, plans.id))
    .where(eq(invoices.id, id))
    .limit(1);

  if (!row) return null;

  return {
    ...row.invoice,
    tenantName: row.tenantName,
    planName: row.planName,
  };
}

export async function findInvoiceByTenantAndId(
  tenantId: string,
  id: string,
): Promise<InvoiceWithDetails | null> {
  const [row] = await db
    .select({
      invoice: invoices,
      tenantName: tenants.name,
      planName: plans.name,
    })
    .from(invoices)
    .innerJoin(tenants, eq(invoices.tenantId, tenants.id))
    .leftJoin(plans, eq(invoices.planId, plans.id))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
    .limit(1);

  if (!row) return null;

  return {
    ...row.invoice,
    tenantName: row.tenantName,
    planName: row.planName,
  };
}

export async function findTenantInvoices(
  tenantId: string,
  options: { page?: number; limit?: number; status?: string },
): Promise<{ items: Invoice[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [eq(invoices.tenantId, tenantId)];
  if (options?.status) {
    conditions.push(eq(invoices.status, options.status));
  }
  const whereClause = and(...conditions);

  const [countResult] = await db.select({ total: count() }).from(invoices).where(whereClause);

  const total = Number(countResult?.total ?? 0);

  const items = await db
    .select()
    .from(invoices)
    .where(whereClause)
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: items ?? [],
    total,
    page,
    limit,
  };
}

export async function findAllInvoices(options: {
  page?: number;
  limit?: number;
  tenantId?: string;
  status?: string;
}): Promise<{ items: InvoiceWithDetails[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];
  if (options?.tenantId) {
    conditions.push(eq(invoices.tenantId, options.tenantId));
  }
  if (options?.status) {
    conditions.push(eq(invoices.status, options.status));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db.select({ total: count() }).from(invoices).where(whereClause);

  const total = Number(countResult?.total ?? 0);

  const rows = await db
    .select({
      invoice: invoices,
      tenantName: tenants.name,
      planName: plans.name,
    })
    .from(invoices)
    .innerJoin(tenants, eq(invoices.tenantId, tenants.id))
    .leftJoin(plans, eq(invoices.planId, plans.id))
    .where(whereClause)
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);

  const items = (rows ?? []).map((r) => ({
    ...r.invoice,
    tenantName: r.tenantName,
    planName: r.planName,
  }));

  return {
    items,
    total,
    page,
    limit,
  };
}

export async function updateInvoiceStatus(
  id: string,
  status: string,
  paidAt?: Date,
): Promise<Invoice | null> {
  const updateData: Partial<NewInvoice> = {
    status,
    ...(paidAt ? { paidAt } : {}),
  };

  const [updated] = await db
    .update(invoices)
    .set(updateData)
    .where(eq(invoices.id, id))
    .returning();

  return updated ?? null;
}
