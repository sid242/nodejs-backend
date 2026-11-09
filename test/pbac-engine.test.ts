import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { Policy } from '../src/db/schema/access/policies';
import { leads } from '../src/db/schema/crm/leads';
import {
  compileConditionTreeToSql,
  compilePoliciesToSqlScope,
} from '../src/modules/pbac/pbac.compiler';
import {
  evaluateAttributeCondition,
  evaluateConditionTree,
  evaluatePolicies,
} from '../src/modules/pbac/pbac.evaluator';

describe('PBAC Evaluator — Attribute & Tree Evaluation', () => {
  const actor = {
    userId: 'user-123',
    memberId: 'member-456',
    roleKeys: ['SALES_REP'],
    departmentId: 'sales-enterprise',
    regionId: 'apac',
  };

  test('evaluates $eq with dynamic variable actor.memberId', () => {
    const condition = {
      attribute: 'resource.assignedMemberId',
      operator: '$eq' as const,
      value: 'actor.memberId',
    };

    assert.equal(
      evaluateAttributeCondition(condition, {
        actor,
        resource: { assignedMemberId: 'member-456' },
      }),
      true,
    );

    assert.equal(
      evaluateAttributeCondition(condition, {
        actor,
        resource: { assignedMemberId: 'member-999' },
      }),
      false,
    );
  });

  test('evaluates $in with literal array', () => {
    const condition = {
      attribute: 'resource.status',
      operator: '$in' as const,
      value: ['new', 'contacted', 'qualified'],
    };

    assert.equal(
      evaluateAttributeCondition(condition, {
        actor,
        resource: { status: 'contacted' },
      }),
      true,
    );

    assert.equal(
      evaluateAttributeCondition(condition, {
        actor,
        resource: { status: 'won' },
      }),
      false,
    );
  });

  test('evaluates numeric comparisons $gt and $lte', () => {
    const condGt = {
      attribute: 'resource.value',
      operator: '$gt' as const,
      value: 1000,
    };

    assert.equal(
      evaluateAttributeCondition(condGt, {
        actor,
        resource: { value: 1500 },
      }),
      true,
    );

    assert.equal(
      evaluateAttributeCondition(condGt, {
        actor,
        resource: { value: 500 },
      }),
      false,
    );
  });

  test('evaluates nested condition trees (all, any, none)', () => {
    const tree = {
      all: [
        {
          attribute: 'resource.departmentId',
          operator: '$eq' as const,
          value: 'actor.departmentId',
        },
      ],
      none: [
        {
          attribute: 'resource.isConfidential',
          operator: '$eq' as const,
          value: true,
        },
      ],
    };

    // Department matches, not confidential -> allowed
    assert.equal(
      evaluateConditionTree(tree, {
        actor,
        resource: { departmentId: 'sales-enterprise', isConfidential: false },
      }),
      true,
    );

    // Confidential -> none rule fails
    assert.equal(
      evaluateConditionTree(tree, {
        actor,
        resource: { departmentId: 'sales-enterprise', isConfidential: true },
      }),
      false,
    );

    // Wrong department -> all rule fails
    assert.equal(
      evaluateConditionTree(tree, {
        actor,
        resource: { departmentId: 'engineering', isConfidential: false },
      }),
      false,
    );
  });

  test('precedence: explicit DENY overrides explicit ALLOW', () => {
    const allowPolicy: Policy = {
      id: 'p-allow',
      tenantId: 'tenant-1',
      name: 'Allow Department Leads',
      description: null,
      resource: 'leads',
      action: 'read',
      effect: 'allow',
      priority: 10,
      isActive: true,
      conditions: {
        attribute: 'resource.departmentId',
        operator: '$eq',
        value: 'sales-enterprise',
      },
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const denyPolicy: Policy = {
      id: 'p-deny',
      tenantId: 'tenant-1',
      name: 'Deny Confidential Leads',
      description: null,
      resource: 'leads',
      action: 'read',
      effect: 'deny',
      priority: 100, // Higher priority
      isActive: true,
      conditions: {
        attribute: 'resource.isConfidential',
        operator: '$eq',
        value: true,
      },
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = evaluatePolicies([allowPolicy, denyPolicy], {
      actor,
      resource: {
        departmentId: 'sales-enterprise',
        isConfidential: true,
      },
    });

    assert.equal(result.allowed, false);
    assert.equal(result.effect, 'deny');
  });

  test('precedence: default DENY when no policies match', () => {
    const policy: Policy = {
      id: 'p-1',
      tenantId: 'tenant-1',
      name: 'Allow APAC',
      description: null,
      resource: 'leads',
      action: 'read',
      effect: 'allow',
      priority: 10,
      isActive: true,
      conditions: {
        attribute: 'resource.regionId',
        operator: '$eq',
        value: 'emea',
      },
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = evaluatePolicies([policy], {
      actor,
      resource: { regionId: 'apac' },
    });

    assert.equal(result.allowed, false);
    assert.equal(result.effect, 'default_deny');
  });
});

describe('PBAC Compiler — SQL Clause Compilation', () => {
  const actor = {
    userId: 'user-123',
    memberId: 'member-456',
    roleKeys: ['SALES_REP'],
    departmentId: 'sales-enterprise',
    regionId: 'apac',
  };

  test('compiles attribute condition with dynamic value to SQL', () => {
    const sqlClause = compileConditionTreeToSql(
      {
        attribute: 'resource.assignedMemberId',
        operator: '$eq',
        value: 'actor.memberId',
      },
      leads as any,
      actor,
    );

    assert.ok(sqlClause);
  });

  test('compiles policies to SQL scope with default deny on empty list', () => {
    const scope = compilePoliciesToSqlScope([], leads as any, actor);
    assert.equal(scope.hasDenyAll, true);
    assert.equal(scope.hasUnconditionalAllow, false);
    assert.ok(scope.sqlClause);
  });

  test('compiles unconditional allow when conditions are empty', () => {
    const allowPolicy: Policy = {
      id: 'p-full',
      tenantId: 'tenant-1',
      name: 'Unconditional Admin Access',
      description: null,
      resource: 'leads',
      action: 'read',
      effect: 'allow',
      priority: 0,
      isActive: true,
      conditions: {},
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const scope = compilePoliciesToSqlScope([allowPolicy], leads as any, actor);
    assert.equal(scope.hasDenyAll, false);
    assert.equal(scope.hasUnconditionalAllow, true);
    assert.equal(scope.sqlClause, undefined);
  });
});
