import { AppError } from '@/lib/errors';
import { createDownloadUrl } from '@/lib/s3';
import * as platformRepo from '@/modules/platform/platform.repository';

import type {
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  ListPlatformInvoicesQueryDto,
} from './billing.dto';
import { billingRepo } from './billing.repository';

// ==========================================
// 6. Invoices Management
// ==========================================

export async function getTenantInvoices(tenantId: string, query?: ListInvoicesQueryDto) {
  return billingRepo.findInvoicesByTenantId(tenantId, query);
}

export async function getTenantInvoiceById(tenantId: string, invoiceId: string) {
  const invoice = await billingRepo.findInvoiceById(invoiceId);
  if (!invoice || invoice.tenantId !== tenantId) {
    throw AppError.notFound('Invoice not found');
  }
  return invoice;
}

export async function downloadTenantInvoice(tenantId: string, invoiceId: string) {
  const invoice = await getTenantInvoiceById(tenantId, invoiceId);

  let downloadUrl = invoice.pdfUrl;
  if (invoice.pdfUrl && !invoice.pdfUrl.startsWith('http')) {
    downloadUrl = await createDownloadUrl(invoice.pdfUrl, 300, {
      filename: `invoice-${invoice.invoiceNumber}.pdf`,
      disposition: 'attachment',
    });
  }

  return {
    invoiceNumber: invoice.invoiceNumber,
    downloadUrl: downloadUrl ?? null,
    invoice,
  };
}

export async function listPlatformInvoices(query?: ListPlatformInvoicesQueryDto) {
  return billingRepo.listInvoicesForPlatform(query);
}

export async function getPlatformInvoiceById(invoiceId: string) {
  const invoice = await billingRepo.findInvoiceById(invoiceId);
  if (!invoice) throw AppError.notFound('Invoice not found');
  return invoice;
}

export async function createPlatformInvoice(
  actorStaffId: string,
  dto: CreateInvoiceDto,
  requestId?: string,
) {
  const created = await billingRepo.createInvoice({
    tenantId: dto.tenantId,
    planId: dto.planId,
    subscriptionId: dto.subscriptionId,
    amountCents: dto.amountCents,
    taxCents: dto.taxCents,
    currency: dto.currency,
    lineItems: dto.lineItems,
    billingPeriodStart: dto.billingPeriodStart,
    billingPeriodEnd: dto.billingPeriodEnd,
    dueDate: dto.dueDate,
    status: dto.status,
  });

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'invoice.created',
    targetType: 'invoice',
    targetId: created.id,
    tenantId: dto.tenantId,
    metadata: {
      invoiceNumber: created.invoiceNumber,
      amountCents: created.amountCents,
      currency: created.currency,
    },
    requestId,
  });

  return created;
}

export async function updateInvoiceStatus(
  actorStaffId: string,
  invoiceId: string,
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTABLE',
  paidAt?: Date,
  requestId?: string,
) {
  const updated = await billingRepo.updateInvoiceStatus(invoiceId, status, paidAt);
  if (!updated) throw AppError.notFound('Invoice not found');

  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'invoice.status_updated',
    targetType: 'invoice',
    targetId: invoiceId,
    tenantId: updated.tenantId,
    metadata: { status, paidAt },
    requestId,
  });

  return updated;
}
