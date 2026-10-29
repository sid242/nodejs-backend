import { z } from 'zod';

export const planLimitsDto = z.object({
  maxMembers: z.number().int().min(1).nullable(),
  maxStorageBytes: z.number().int().min(0).nullable(),
  maxCustomRoles: z.number().int().min(0).nullable(),
});

export const createPlanDto = z.object({
  key: z.string().trim().min(2).max(50).toUpperCase(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).optional(),
  priceMonthlyMinor: z.coerce.number().int().min(0).default(0),
  priceYearlyMinor: z.coerce.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('INR'),
  trialDays: z.coerce.number().int().min(0).default(14),
  limits: planLimitsDto,
  moduleKeys: z.array(z.string()).optional(),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export const updatePlanDto = createPlanDto.partial();

export const planIdParamDto = z.object({
  id: z.string().uuid(),
});

export const listPlansQueryDto = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export const tenantSubscriptionParamDto = z.object({
  id: z.string().uuid(),
});

export const updateSubscriptionDto = z.object({
  planKey: z.string().trim().min(1).max(50).toUpperCase().optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED']).optional(),
  currentPeriodStart: z.coerce.date().optional(),
  currentPeriodEnd: z.coerce.date().optional(),
  trialEndsAt: z.coerce.date().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

export const subscriptionChangeRequestDto = z.object({
  targetPlanKey: z.string().trim().min(1).max(50).toUpperCase(),
  reason: z.string().trim().max(500).optional(),
});

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
  currency: z.string().trim().length(3).default('INR'),
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

export type CreatePlanDto = z.infer<typeof createPlanDto>;
export type UpdatePlanDto = z.infer<typeof updatePlanDto>;
export type ListPlansQueryDto = z.infer<typeof listPlansQueryDto>;
export type UpdateSubscriptionDto = z.infer<typeof updateSubscriptionDto>;
export type SubscriptionChangeRequestDto = z.infer<typeof subscriptionChangeRequestDto>;
export type ListInvoicesQueryDto = z.infer<typeof listInvoicesQueryDto>;
export type ListPlatformInvoicesQueryDto = z.infer<typeof listPlatformInvoicesQueryDto>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceDto>;
export type UpdateInvoiceStatusDto = z.infer<typeof updateInvoiceStatusDto>;
