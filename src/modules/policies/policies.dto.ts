import { z } from 'zod';

import { isValidAction, isValidResource } from '@/modules/pbac/pbac.registry';

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

export const alwaysConditionSchema = z
  .object({
    always: z.literal(true),
  })
  .strict();

export const attributeConditionSchema = z
  .object({
    attribute: z.string().min(1).max(100),
    operator: conditionOperatorSchema,
    value: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number()])),
      z.null(),
    ]),
  })
  .strict();

export const conditionRuleSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      all: z.array(z.lazy(() => policyConditionItemSchema)).min(1).optional(),
      any: z.array(z.lazy(() => policyConditionItemSchema)).min(1).optional(),
      none: z.array(z.lazy(() => policyConditionItemSchema)).min(1).optional(),
    })
    .strict()
    .refine((val) => val.all !== undefined || val.any !== undefined || val.none !== undefined, {
      message: 'Rule object must contain at least one of: all, any, none',
    }),
);

export const policyConditionItemSchema: z.ZodType<unknown> = z.union([
  attributeConditionSchema,
  conditionRuleSchema,
]);

/**
 * Calculates max depth and total node count in a condition tree.
 */
export function getTreeStats(tree: unknown, currentDepth = 1): { depth: number; count: number } {
  if (!tree || typeof tree !== 'object') {
    return { depth: currentDepth, count: 0 };
  }

  if ('always' in tree) {
    return { depth: currentDepth, count: 1 };
  }

  if ('attribute' in tree && 'operator' in tree) {
    return { depth: currentDepth, count: 1 };
  }

  const obj = tree as Record<string, unknown>;
  const children: unknown[] = [
    ...(Array.isArray(obj.all) ? obj.all : []),
    ...(Array.isArray(obj.any) ? obj.any : []),
    ...(Array.isArray(obj.none) ? obj.none : []),
  ];

  let maxChildDepth = currentDepth;
  let totalCount = 1;

  for (const child of children) {
    const childStats = getTreeStats(child, currentDepth + 1);
    totalCount += childStats.count;
    if (childStats.depth > maxChildDepth) {
      maxChildDepth = childStats.depth;
    }
  }

  return { depth: maxChildDepth, count: totalCount };
}

export const policyConditionsSchema = z
  .union([alwaysConditionSchema, attributeConditionSchema, conditionRuleSchema])
  .superRefine((val, ctx) => {
    const stats = getTreeStats(val, 1);
    if (stats.depth > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Condition tree nesting depth (${stats.depth}) exceeds maximum allowed depth of 5`,
      });
    }
    if (stats.count > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Condition tree node count (${stats.count}) exceeds maximum allowed nodes of 50`,
      });
    }
  });

export const createPolicyDto = z
  .object({
    name: z.string().min(2).max(100),
    description: z.string().max(500).optional(),
    resource: z
      .string()
      .min(1)
      .max(50)
      .refine((res) => isValidResource(res), {
        message: 'Resource is not recognized in PBAC registry',
      }),
    action: z.string().min(1).max(50),
    effect: policyEffectSchema.default('allow'),
    conditions: policyConditionsSchema,
    priority: z.coerce.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .refine((data) => isValidAction(data.resource, data.action), {
    message: 'Action is not valid for the specified resource',
    path: ['action'],
  });

export type CreatePolicyDto = z.infer<typeof createPolicyDto>;

export const updatePolicyDto = z
  .object({
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(500).optional(),
    resource: z
      .string()
      .min(1)
      .max(50)
      .refine((res) => isValidResource(res), {
        message: 'Resource is not recognized in PBAC registry',
      })
      .optional(),
    action: z.string().min(1).max(50).optional(),
    effect: policyEffectSchema.optional(),
    conditions: policyConditionsSchema.optional(),
    priority: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.resource && data.action) {
        return isValidAction(data.resource, data.action);
      }
      return true;
    },
    {
      message: 'Action is not valid for the specified resource',
      path: ['action'],
    },
  );

export type UpdatePolicyDto = z.infer<typeof updatePolicyDto>;

export const evaluatePolicyDto = z.object({
  roleId: z.string().uuid().optional(),
  policyId: z.string().uuid().optional(),
  resource: z.string().min(1).max(50),
  action: z.string().min(1).max(50),
  record: z.record(z.unknown()).optional().default({}),
  actor: z
    .object({
      userId: z.string().optional(),
      memberId: z.string().optional(),
      roleKeys: z.array(z.string()).optional().default([]),
      departmentId: z.string().nullable().optional(),
      regionId: z.string().nullable().optional(),
      attributes: z.record(z.unknown()).optional(),
    })
    .optional(),
  conditions: policyConditionsSchema.optional(),
});

export type EvaluatePolicyDto = z.infer<typeof evaluatePolicyDto>;

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
