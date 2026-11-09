import { z } from 'zod';

export const policyEffectSchema = z.enum(['allow', 'deny']);

export const conditionOperatorSchema = z.enum([
  '$eq',
  '$ne',
  '$in',
  '$nin',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$contains',
  '$startsWith',
]);

export const attributeConditionSchema = z.object({
  attribute: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
    z.null(),
  ]),
});

export const conditionRuleSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    all: z.array(z.union([attributeConditionSchema, conditionRuleSchema])).optional(),
    any: z.array(z.union([attributeConditionSchema, conditionRuleSchema])).optional(),
    none: z.array(z.union([attributeConditionSchema, conditionRuleSchema])).optional(),
  }),
);

export const policyConditionsSchema = z.union([
  attributeConditionSchema,
  conditionRuleSchema,
  z.record(z.unknown()), // allows empty condition `{}`
]);

export const createPolicyDto = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  resource: z.string().min(1).max(50),
  action: z.string().min(1).max(50),
  effect: policyEffectSchema.default('allow'),
  conditions: policyConditionsSchema,
  priority: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

export type CreatePolicyDto = z.infer<typeof createPolicyDto>;

export const updatePolicyDto = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  resource: z.string().min(1).max(50).optional(),
  action: z.string().min(1).max(50).optional(),
  effect: policyEffectSchema.optional(),
  conditions: policyConditionsSchema.optional(),
  priority: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

export type UpdatePolicyDto = z.infer<typeof updatePolicyDto>;

export const policyIdParamDto = z.object({
  policyId: z.string().uuid(),
});

export type PolicyIdParamDto = z.infer<typeof policyIdParamDto>;

export const policyRoleParamDto = z.object({
  policyId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export type PolicyRoleParamDto = z.infer<typeof policyRoleParamDto>;

export const roleIdParamDto = z.object({
  roleId: z.string().uuid(),
});

export type RoleIdParamDto = z.infer<typeof roleIdParamDto>;

export const listPoliciesQueryDto = z.object({
  resource: z.string().optional(),
  action: z.string().optional(),
  effect: policyEffectSchema.optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListPoliciesQueryDto = z.infer<typeof listPoliciesQueryDto>;
