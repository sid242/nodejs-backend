import { z } from 'zod';

export const createFeatureFlagDto = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(
      /^[a-z0-9_.-]+$/,
      'Key must contain only lowercase alphanumeric, underscore, dot, or dash',
    ),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  type: z.enum(['BOOLEAN', 'PERCENT', 'VARIANT']).default('BOOLEAN'),
  defaultValue: z.any().default(false),
  tags: z.array(z.string().trim()).optional(),
});

export type CreateFeatureFlagDto = z.infer<typeof createFeatureFlagDto>;

export const updateFeatureFlagDto = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  defaultValue: z.any().optional(),
  killSwitch: z.boolean().optional(),
  tags: z.array(z.string().trim()).optional(),
});

export type UpdateFeatureFlagDto = z.infer<typeof updateFeatureFlagDto>;

export const createFeatureFlagRuleDto = z.object({
  priority: z.coerce.number().int().default(0),
  target: z.enum(['TENANT', 'PLAN', 'USER', 'PERCENT', 'ENV']),
  matchCriteria: z.any().optional(),
  value: z.any(),
});

export type CreateFeatureFlagRuleDto = z.infer<typeof createFeatureFlagRuleDto>;

export const updateFeatureFlagRuleDto = z.object({
  priority: z.coerce.number().int().optional(),
  target: z.enum(['TENANT', 'PLAN', 'USER', 'PERCENT', 'ENV']).optional(),
  matchCriteria: z.any().optional(),
  value: z.any().optional(),
});

export type UpdateFeatureFlagRuleDto = z.infer<typeof updateFeatureFlagRuleDto>;

export const evaluationContextDto = z.object({
  tenantId: z.string().guid().optional(),
  userId: z.string().guid().optional(),
  plan: z.string().trim().optional(),
});

export type EvaluationContextDto = z.infer<typeof evaluationContextDto>;
