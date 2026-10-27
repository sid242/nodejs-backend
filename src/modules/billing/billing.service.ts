import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import * as plansRepo from '@/modules/plans/plans.repository';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';

import type {
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  ListPlatformInvoicesQueryDto,
  UpdateInvoiceStatusDto,
} from './billing.dto';
import * as billingRepo from './billing.repository';

export async function createInvoice(data: CreateInvoiceDto) {
  const tenant = await tenantsRepo.findTenantById(data.tenantId);
  if (!tenant) {
    throw AppError.notFound('Customer tenant workspace not found');
  }

  if (data?.planId) {
    const plan = await plansRepo.findPlanById(data.planId);
    if (!plan) {
      throw AppError.notFound('Target SaaS plan not found');
    }
  }

  const invoice = await billingRepo.createInvoice({
    tenantId: data.tenantId,
    planId: data?.planId,
    subscriptionId: data?.subscriptionId,
    amountCents: data.amountCents,
    taxCents: data.taxCents ?? 0,
    currency: data.currency ?? 'USD',
    lineItems: data.lineItems,
    billingPeriodStart: data.billingPeriodStart,
    billingPeriodEnd: data.billingPeriodEnd,
    dueDate: data.dueDate,
    status: data.status ?? 'OPEN',
    paidAt: data.status === 'PAID' ? new Date() : undefined,
  });

  await cache.delByPrefix(`billing:tenant:${data.tenantId}:`);
  return invoice;
}

export async function getTenantInvoices(tenantId: string, query: ListInvoicesQueryDto) {
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 20;
  const status = query?.status ?? 'ALL';

  return cache.wrap(
    `billing:tenant:${tenantId}:invoices:${page}:${limit}:${status}`,
    60,
    async () => {
      return billingRepo.findTenantInvoices(tenantId, {
        page: query?.page,
        limit: query?.limit,
        status: query?.status,
      });
    },
  );
}

export async function getTenantInvoiceById(tenantId: string, invoiceId: string) {
  const invoice = await billingRepo.findInvoiceByTenantAndId(tenantId, invoiceId);
  if (!invoice) {
    throw AppError.notFound('Invoice not found');
  }
  return invoice;
}

export async function getPlatformInvoices(query: ListPlatformInvoicesQueryDto) {
  return billingRepo.findAllInvoices({
    page: query?.page,
    limit: query?.limit,
    tenantId: query?.tenantId,
    status: query?.status,
  });
}

export async function getPlatformInvoiceById(invoiceId: string) {
  const invoice = await billingRepo.findInvoiceById(invoiceId);
  if (!invoice) {
    throw AppError.notFound('Invoice not found');
  }
  return invoice;
}

export async function updateInvoiceStatus(invoiceId: string, data: UpdateInvoiceStatusDto) {
  const existing = await billingRepo.findInvoiceById(invoiceId);
  if (!existing) {
    throw AppError.notFound('Invoice not found');
  }

  const paidAt = data.status === 'PAID' ? (data.paidAt ?? new Date()) : undefined;
  const updated = await billingRepo.updateInvoiceStatus(invoiceId, data.status, paidAt);

  if (existing.tenantId) {
    await cache.delByPrefix(`billing:tenant:${existing.tenantId}:`);
  }

  return updated;
}
