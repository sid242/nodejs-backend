import { z } from 'zod';

export const invoiceLineItemDto = z.object({
  description: z.string().trim().min(1).max(255),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPriceCents: z.coerce.number().int().min(0),
  totalCents: z.coerce.number().int().min(0),
});

export const listInvoicesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTABLE']).optional(),
});

export const listPlatformInvoicesQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tenantId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTABLE']).optional(),
});

export const invoiceIdParamDto = z.object({
  id: z.string().uuid(),
});

export const createInvoiceDto = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid().optional(),
  subscriptionId: z.string().uuid().optional(),
  amountCents: z.coerce.number().int().min(0),
  taxCents: z.coerce.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('USD'),
  lineItems: z.array(invoiceLineItemDto).min(1),
  billingPeriodStart: z.coerce.date().optional(),
  billingPeriodEnd: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(['DRAFT', 'OPEN', 'PAID']).default('OPEN'),
});

export const updateInvoiceStatusDto = z.object({
  status: z.enum(['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTABLE']),
  paidAt: z.coerce.date().optional(),
});

export type ListInvoicesQueryDto = z.infer<typeof listInvoicesQueryDto>;
export type ListPlatformInvoicesQueryDto = z.infer<typeof listPlatformInvoicesQueryDto>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceDto>;
export type UpdateInvoiceStatusDto = z.infer<typeof updateInvoiceStatusDto>;
