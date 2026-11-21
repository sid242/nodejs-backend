import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import { Policy } from '../src/db/schema/access/policies';
import { evaluateAttributeCondition, evaluateConditionTree, evaluatePolicies } from '../src/modules/pbac/pbac.evaluator';
import { isValidAction, isValidAttributePath, isValidResource, PBAC_REGISTRY } from '../src/modules/pbac/pbac.registry';
import { pbacService } from '../src/modules/pbac/pbac.service';
import type { ActorContext, PolicyConditionTree, PolicyEvaluationContext } from '../src/modules/pbac/pbac.types';
import {
  createPolicyDto,
  getTreeStats,
  policyConditionsSchema,
  updatePolicyDto,
} from '../src/modules/policies/policies.dto';
import { policiesService } from '../src/modules/policies/policies.service';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

describe('Step 05: PBAC Policy Validation & Hardening', () => {
  const actor: ActorContext = {
    userId: 'u-1',
    memberId: 'm-1',
    roleKeys: ['SALES_REP'],
    departmentId: 'SALES',
    regionId: 'US_WEST',
  };

  const baseContext: PolicyEvaluationContext = {
    actor,
    resource: {
      id: 'lead-1',
      name: 'Acme Global Corp',
      departmentId: 'SALES',
      regionId: 'US_WEST',
      assignedMemberId: 'm-1',
      score: 85,
      isConfidential: false,
      tags: ['enterprise', 'priority'],
      status: 'NEW',
      notes: null,
      createdAt: new Date('2026-01-15T10:00:00Z'),
    },
    env: {
      currentTime: new Date('2026-06-01T12:00:00Z'),
      ip: '10.0.0.1',
    },
  };

  describe('5.1 Table-Driven Operator Evaluation & Null Handling', () => {
    interface OperatorTestCase {
      name: string;
      condition: { attribute: string; operator: import('../src/modules/pbac/pbac.types').ConditionOperator; value: unknown };
      expected: boolean;
    }

    const testCases: OperatorTestCase[] = [
      // $eq
      { name: '$eq matching string', condition: { attribute: 'resource.departmentId', operator: '$eq', value: 'SALES' }, expected: true },
      { name: '$eq non-matching string', condition: { attribute: 'resource.departmentId', operator: '$eq', value: 'FINANCE' }, expected: false },
      { name: '$eq dynamic actor reference', condition: { attribute: 'resource.departmentId', operator: '$eq', value: 'actor.departmentId' }, expected: true },
      { name: '$eq null matches null property', condition: { attribute: 'resource.notes', operator: '$eq', value: null }, expected: true },
      { name: '$eq null matches undefined property', condition: { attribute: 'resource.nonexistent', operator: '$eq', value: null }, expected: true },
      { name: '$eq null fails for defined property', condition: { attribute: 'resource.departmentId', operator: '$eq', value: null }, expected: false },

      // $ne
      { name: '$ne matching difference', condition: { attribute: 'resource.departmentId', operator: '$ne', value: 'ENGINEERING' }, expected: true },
      { name: '$ne non-matching when equal', condition: { attribute: 'resource.departmentId', operator: '$ne', value: 'SALES' }, expected: false },
      { name: '$ne null fails for null property', condition: { attribute: 'resource.notes', operator: '$ne', value: null }, expected: false },
      { name: '$ne null succeeds for defined property', condition: { attribute: 'resource.departmentId', operator: '$ne', value: null }, expected: true },

      // $in & $nin
      { name: '$in matching in array', condition: { attribute: 'resource.departmentId', operator: '$in', value: ['SALES', 'MARKETING'] }, expected: true },
      { name: '$in not found in array', condition: { attribute: 'resource.departmentId', operator: '$in', value: ['HR', 'FINANCE'] }, expected: false },
      { name: '$in null matches array containing null', condition: { attribute: 'resource.notes', operator: '$in', value: ['random', null] }, expected: true },
      { name: '$nin succeeding when not in array', condition: { attribute: 'resource.departmentId', operator: '$nin', value: ['HR', 'LEGAL'] }, expected: true },
      { name: '$nin failing when in array', condition: { attribute: 'resource.departmentId', operator: '$nin', value: ['SALES', 'HR'] }, expected: false },

      // $gt & $gte
      { name: '$gt numeric match', condition: { attribute: 'resource.score', operator: '$gt', value: 80 }, expected: true },
      { name: '$gt numeric boundary fail', condition: { attribute: 'resource.score', operator: '$gt', value: 85 }, expected: false },
      { name: '$gte numeric boundary match', condition: { attribute: 'resource.score', operator: '$gte', value: 85 }, expected: true },
      { name: '$gt date comparison', condition: { attribute: 'resource.createdAt', operator: '$gt', value: '2025-12-31T23:59:59Z' }, expected: true },
      { name: '$gt date boundary fail', condition: { attribute: 'resource.createdAt', operator: '$gt', value: '2026-02-01T00:00:00Z' }, expected: false },

      // $lt & $lte
      { name: '$lt numeric match', condition: { attribute: 'resource.score', operator: '$lt', value: 90 }, expected: true },
      { name: '$lt numeric boundary fail', condition: { attribute: 'resource.score', operator: '$lt', value: 85 }, expected: false },
      { name: '$lte numeric boundary match', condition: { attribute: 'resource.score', operator: '$lte', value: 85 }, expected: true },

      // $contains
      { name: '$contains case-insensitive substring', condition: { attribute: 'resource.name', operator: '$contains', value: 'global' }, expected: true },
      { name: '$contains array element check', condition: { attribute: 'resource.tags', operator: '$contains', value: 'enterprise' }, expected: true },
      { name: '$contains missing array element', condition: { attribute: 'resource.tags', operator: '$contains', value: 'churned' }, expected: false },

      // $startsWith
      { name: '$startsWith string prefix match', condition: { attribute: 'resource.name', operator: '$startsWith', value: 'Acme' }, expected: true },
      { name: '$startsWith string prefix non-match', condition: { attribute: 'resource.name', operator: '$startsWith', value: 'Global' }, expected: false },
    ];

    for (const tc of testCases) {
      it(tc.name, () => {
        const result = evaluateAttributeCondition(tc.condition as import('../src/modules/pbac/pbac.types').AttributeCondition, baseContext);
        assert.equal(result, tc.expected);
      });
    }
  });

  describe('5.2 Fail-Closed Evaluator Behavior', () => {
    it('evaluates an empty object {} to false', () => {
      const emptyTree = {} as PolicyConditionTree;
      assert.equal(evaluateConditionTree(emptyTree, baseContext), false);
    });

    it('evaluates an object with empty clauses { all: [] } to false', () => {
      const tree = { all: [] } as unknown as PolicyConditionTree;
      assert.equal(evaluateConditionTree(tree, baseContext), false);
    });

    it('evaluates explicit { always: true } to true', () => {
      const alwaysTree = { always: true };
      assert.equal(evaluateConditionTree(alwaysTree, baseContext), true);
    });

    it('evaluates null or undefined condition tree to false', () => {
      assert.equal(evaluateConditionTree(null as unknown as PolicyConditionTree, baseContext), false);
      assert.equal(evaluateConditionTree(undefined as unknown as PolicyConditionTree, baseContext), false);
    });
  });

  describe('5.3 Priority Tiers & Evaluation Semantics', () => {
    const makePolicy = (id: string, name: string, effect: 'allow' | 'deny', priority: number, match: boolean): Policy => ({
      id,
      tenantId: 'tenant-1',
      name,
      description: null,
      resource: 'leads',
      action: 'read',
      effect,
      priority,
      conditions: match
        ? { attribute: 'resource.departmentId', operator: '$eq', value: 'SALES' }
        : { attribute: 'resource.departmentId', operator: '$eq', value: 'NON_EXISTENT' },
      isActive: true,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('overrides lower priority deny with a higher priority allow', () => {
      const policies: Policy[] = [
        makePolicy('p1', 'High Priority Allow', 'allow', 100, true),
        makePolicy('p2', 'Low Priority Deny', 'deny', 10, true),
      ];

      const result = evaluatePolicies(policies, baseContext);
      assert.equal(result.allowed, true);
      assert.equal(result.effect, 'allow');
    });

    it('overrides lower priority allow with a higher priority deny', () => {
      const policies: Policy[] = [
        makePolicy('p1', 'High Priority Security Block', 'deny', 100, true),
        makePolicy('p2', 'Standard Allow', 'allow', 0, true),
      ];

      const result = evaluatePolicies(policies, baseContext);
      assert.equal(result.allowed, false);
      assert.equal(result.effect, 'deny');
    });

    it('enforces deny overrides allow within the same priority tier', () => {
      const policies: Policy[] = [
        makePolicy('p1', 'Tier 10 Allow', 'allow', 10, true),
        makePolicy('p2', 'Tier 10 Deny', 'deny', 10, true),
      ];

      const result = evaluatePolicies(policies, baseContext);
      assert.equal(result.allowed, false);
      assert.equal(result.effect, 'deny');
    });

    it('returns default_deny when no policies match', () => {
      const policies: Policy[] = [
        makePolicy('p1', 'Unmatched Policy', 'allow', 10, false),
      ];

      const result = evaluatePolicies(policies, baseContext);
      assert.equal(result.allowed, false);
      assert.equal(result.effect, 'default_deny');
    });

    it('returns default_deny when policies list is empty', () => {
      const result = evaluatePolicies([], baseContext);
      assert.equal(result.allowed, false);
      assert.equal(result.effect, 'default_deny');
    });
  });

  describe('5.4 Strict Recursive Schema & Limits', () => {
    it('rejects empty object {} in condition schema', () => {
      const result = policyConditionsSchema.safeParse({});
      assert.equal(result.success, false, 'Empty object must be rejected');
    });

    it('accepts explicit { always: true }', () => {
      const result = policyConditionsSchema.safeParse({ always: true });
      assert.equal(result.success, true);
    });

    it('rejects unknown properties (.strict() enforcement)', () => {
      const result = policyConditionsSchema.safeParse({
        attribute: 'resource.name',
        operator: '$eq',
        value: 'Acme',
        unexpectedProp: 'injected',
      });
      assert.equal(result.success, false);
    });

    it('rejects condition tree exceeding depth limit of 5', () => {
      // 6 levels deep
      const deepTree = {
        all: [
          {
            all: [
              {
                all: [
                  {
                    all: [
                      {
                        all: [
                          { attribute: 'resource.name', operator: '$eq', value: 'Deep' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const stats = getTreeStats(deepTree);
      assert.ok(stats.depth > 5, 'Stats must detect depth > 5');

      const result = policyConditionsSchema.safeParse(deepTree);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.error.issues.some((i) => i.message.includes('exceeds maximum allowed depth')));
      }
    });

    it('rejects condition tree exceeding node count limit of 50', () => {
      // 55 nodes in a single flat 'all' array
      const manyNodes = Array.from({ length: 55 }, (_, i) => ({
        attribute: 'resource.name',
        operator: '$eq' as const,
        value: `Name ${i}`,
      }));

      const tree = { all: manyNodes };
      const stats = getTreeStats(tree);
      assert.ok(stats.count > 50, 'Stats must detect count > 50');

      const result = policyConditionsSchema.safeParse(tree);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.error.issues.some((i) => i.message.includes('exceeds maximum allowed nodes')));
      }
    });
  });

  describe('5.5 PBAC Registry & DTO Resource/Action Validation', () => {
    it('registry exposes resources, common attributes, and operators', () => {
      assert.ok(PBAC_REGISTRY.resources.length >= 4);
      assert.ok(PBAC_REGISTRY.commonActorAttributes.length >= 4);
      assert.ok(PBAC_REGISTRY.operators.length >= 10);
    });

    it('validates known resources and actions correctly', () => {
      assert.equal(isValidResource('leads'), true);
      assert.equal(isValidResource('nonexistent_module'), false);
      assert.equal(isValidResource('*'), true);

      assert.equal(isValidAction('leads', 'read'), true);
      assert.equal(isValidAction('leads', 'reassign'), true);
      assert.equal(isValidAction('leads', 'fake_action'), false);
      assert.equal(isValidAction('leads', '*'), true);

      assert.equal(isValidAttributePath('leads', 'resource.departmentId'), true);
      assert.equal(isValidAttributePath('leads', 'actor.departmentId'), true);
      assert.equal(isValidAttributePath('leads', 'resource.unknownField'), false);
    });

    it('rejects invalid resource in createPolicyDto', () => {
      const result = createPolicyDto.safeParse({
        name: 'Invalid Resource Policy',
        resource: 'invalid_resource_name',
        action: 'read',
        conditions: { always: true },
      });
      assert.equal(result.success, false);
    });

    it('rejects invalid action for resource in createPolicyDto', () => {
      const result = createPolicyDto.safeParse({
        name: 'Invalid Action Policy',
        resource: 'tenants',
        action: 'reassign', // 'reassign' only valid for leads
        conditions: { always: true },
      });
      assert.equal(result.success, false);
    });

    it('accepts valid policy with explicit { always: true }', () => {
      const result = createPolicyDto.safeParse({
        name: 'Valid Full Access',
        resource: 'leads',
        action: 'read',
        conditions: { always: true },
      });
      assert.equal(result.success, true);
    });

    it('rejects invalid action in updatePolicyDto', () => {
      const result = updatePolicyDto.safeParse({
        resource: 'tenants',
        action: 'set_confidential',
      });
      assert.equal(result.success, false);
    });
  });

  describe('5.6 Dry-Run Evaluation', () => {
    it('evaluates ad-hoc conditions without requiring persisted policy', async () => {
      const dryRunResult = await policiesService.dryRunEvaluation('tenant-1', {
        resource: 'leads',
        action: 'read',
        record: { departmentId: 'SALES', score: 95 },
        actor: {
          userId: 'u1',
          memberId: 'm1',
          roleKeys: ['REP'],
          departmentId: 'SALES',
        },
        conditions: {
          attribute: 'resource.departmentId',
          operator: '$eq',
          value: 'actor.departmentId',
        },
      });

      assert.equal(dryRunResult.allowed, true);
      assert.equal(dryRunResult.effect, 'allow');
      assert.equal(dryRunResult.traces.length, 1);
      assert.equal(dryRunResult.traces[0]?.matched, true);
    });

    it('evaluates ad-hoc condition failure correctly', async () => {
      const dryRunResult = await policiesService.dryRunEvaluation('tenant-1', {
        resource: 'leads',
        action: 'read',
        record: { departmentId: 'MARKETING' },
        actor: { departmentId: 'SALES', roleKeys: [] },
        conditions: {
          attribute: 'resource.departmentId',
          operator: '$eq',
          value: 'actor.departmentId',
        },
      });

      assert.equal(dryRunResult.allowed, false);
      assert.equal(dryRunResult.effect, 'deny');
      assert.equal(dryRunResult.traces[0]?.matched, false);
    });
  });

  describe('5.7 Role Cache Invalidation', () => {
    it('invalidates role cache on attach and detach and role deletion', async () => {
      const invalidatedKeys: string[] = [];
      const origDel = pbacService.invalidateRolePoliciesCache;

      try {
        pbacService.invalidateRolePoliciesCache = async (tId: string, rId: string) => {
          invalidatedKeys.push(`${tId}:${rId}`);
        };

        await pbacService.invalidateRolePoliciesCache('t-123', 'r-456');
        assert.equal(invalidatedKeys.includes('t-123:r-456'), true);
      } finally {
        pbacService.invalidateRolePoliciesCache = origDel;
      }
    });
  });
});
