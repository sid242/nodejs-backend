import { z } from 'zod';

export const planEntitlementsDto = z.object({
  maxMembers: z.coerce.number().int().min(1).max(10_000).default(5),
  maxProjects: z.coerce.number().int().min(1).max(100_000).default(10),
  maxStorageMb: z.coerce.number().int().min(100).max(10_000_000).default(1024),
  hasCustomRoles: z.boolean().default(false),
  hasAdvancedAnalytics: z.boolean().default(false),
  hasPrioritySupport: z.boolean().default(false),
  hasAuditRetentionDays: z.coerce.number().int().min(1).max(3650).default(7),
});

export const createPlanDto = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, 'Plan key must be uppercase alphanumeric with underscores')
    .transform((k) => k.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  priceCents: z.coerce.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('USD'),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL', 'LIFETIME']).default('MONTHLY'),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  entitlements: planEntitlementsDto.optional(),
});

export const updatePlanDto = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  priceCents: z.coerce.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  billingInterval: z.enum(['MONTHLY', 'ANNUAL', 'LIFETIME']).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  entitlements: planEntitlementsDto.partial().optional(),
});

export const listPlansQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const planIdParamDto = z.object({
  id: z.string().uuid(),
});

export const changeSubscriptionDto = z.object({
  planKey: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .transform((k) => k.toUpperCase()),
  seatCount: z.coerce.number().int().min(1).max(10_000).optional(),
});

export type CreatePlanDto = z.infer<typeof createPlanDto>;
export type UpdatePlanDto = z.infer<typeof updatePlanDto>;
export type ListPlansQueryDto = z.infer<typeof listPlansQueryDto>;
export type ChangeSubscriptionDto = z.infer<typeof changeSubscriptionDto>;
