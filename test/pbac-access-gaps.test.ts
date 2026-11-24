import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Request, Response } from 'express';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import { leads } from '../src/db/schema/crm/leads';
import { AppError } from '../src/lib/errors';
import { leadsRepo } from '../src/modules/leads/leads.repository';
import { leadsService } from '../src/modules/leads/leads.service';
import { compileConditionTreeToSql } from '../src/modules/pbac/pbac.compiler';
import { evaluateConditionTree } from '../src/modules/pbac/pbac.evaluator';
import { requirePolicy } from '../src/modules/pbac/pbac.middleware';
import { pbacService } from '../src/modules/pbac/pbac.service';
import type {
  ActorContext,
  PolicyConditionTree,
  PolicyEvaluationContext,
} from '../src/modules/pbac/pbac.types';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

describe('Step 04: PBAC Access Gaps Hardening', () => {
  describe('4.1 Default Deny on List Queries', () => {
    it('returns empty list immediately for non-owner actors without roles or context', async () => {
      let repoCalled = false;
      const origList = leadsRepo.listLeads;
      try {
        leadsRepo.listLeads = (async () => {
          repoCalled = true;
          return { items: [], total: 0, page: 1, limit: 20 };
        }) as unknown as typeof leadsRepo.listLeads;

        // No roles, no actorContext
        const result = await leadsService.listLeads(
          'tenant-1',
          { page: 1, limit: 20 },
          undefined,
          [],
          false,
        );

        assert.equal(repoCalled, false, 'Repository should not be called when actor has no roles');
        assert.equal(result.items.length, 0);
        assert.equal(result.total, 0);
      } finally {
        leadsRepo.listLeads = origList;
      }
    });

    it('returns empty list when compileQueryScope yields hasDenyAll', async () => {
      const origCompile = pbacService.compileQueryScope;
      try {
        pbacService.compileQueryScope = async () => ({
          sqlClause: undefined,
          hasDenyAll: true,
          hasUnconditionalAllow: false,
        });

        const actorContext: ActorContext = {
          userId: 'user-1',
          memberId: 'member-1',
          roleKeys: ['SALES_REP'],
          departmentId: 'SALES',
          regionId: 'US_WEST',
        };

        const result = await leadsService.listLeads(
          'tenant-1',
          { page: 1, limit: 20 },
          actorContext,
          ['role-1'],
          false,
        );

        assert.equal(result.items.length, 0);
        assert.equal(result.total, 0);
      } finally {
        pbacService.compileQueryScope = origCompile;
      }
    });
  });

  describe('4.5 Compiler/Evaluator Parity & Fail-Closed Behavior', () => {
    const actorContext: ActorContext = {
      userId: 'u1',
      memberId: 'm1',
      roleKeys: ['SALES'],
      departmentId: 'SALES_DEPT',
      regionId: 'APAC',
    };

    const columns = leads as unknown as Record<string, import('drizzle-orm/pg-core').PgColumn>;

    it('compiles $contains and matches evaluator behavior', () => {
      const condition: PolicyConditionTree = {
        attribute: 'resource.name',
        operator: '$contains',
        value: 'Acme',
      };

      const sqlCompiled = compileConditionTreeToSql(condition, columns, actorContext);
      assert.ok(sqlCompiled, 'SQL clause must be produced for $contains');

      // Evaluator match
      const matchingContext: PolicyEvaluationContext = {
        actor: actorContext,
        resource: { name: 'Acme Corp Industries' },
        env: { currentTime: new Date() },
      };
      assert.equal(evaluateConditionTree(condition, matchingContext), true);

      // Evaluator non-match
      const nonMatchingContext: PolicyEvaluationContext = {
        actor: actorContext,
        resource: { name: 'Global Widgets Ltd' },
        env: { currentTime: new Date() },
      };
      assert.equal(evaluateConditionTree(condition, nonMatchingContext), false);
    });

    it('compiles $startsWith and matches evaluator behavior', () => {
      const condition: PolicyConditionTree = {
        attribute: 'resource.name',
        operator: '$startsWith',
        value: 'Tech',
      };

      const sqlCompiled = compileConditionTreeToSql(condition, columns, actorContext);
      assert.ok(sqlCompiled, 'SQL clause must be produced for $startsWith');

      const matchCtx: PolicyEvaluationContext = {
        actor: actorContext,
        resource: { name: 'Technology Ventures' },
        env: { currentTime: new Date() },
      };
      assert.equal(evaluateConditionTree(condition, matchCtx), true);

      const nonMatchCtx: PolicyEvaluationContext = {
        actor: actorContext,
        resource: { name: 'Biotech Global' },
        env: { currentTime: new Date() },
      };
      assert.equal(evaluateConditionTree(condition, nonMatchCtx), false);
    });

    it('fails closed (1 = 0) on unknown attribute and does not widen access in "all" conjunction', () => {
      const condition: PolicyConditionTree = {
        all: [
          { attribute: 'resource.departmentId', operator: '$eq', value: 'SALES' },
          { attribute: 'resource.unknownNonexistentField', operator: '$eq', value: 'SECRET' },
        ],
      };

      const sqlCompiled = compileConditionTreeToSql(condition, columns, actorContext);
      assert.ok(sqlCompiled);

      const query = new PgDialect().sqlToQuery(sqlCompiled);
      assert.ok(query.sql.includes('1 = 0'), 'Uncompilable attribute must compile to 1 = 0');
    });
  });

  describe('4.3 Update-time Escalation Protection', () => {
    it('rejects lead update when reassigning assignedMemberId without leads:reassign permission', async () => {
      const origGetLead = leadsService.getLeadById;
      const origEval = pbacService.evaluateAccess;

      try {
        leadsService.getLeadById = async () =>
          ({
            id: 'lead-1',
            tenantId: 'tenant-1',
            name: 'Important Lead',
            assignedMemberId: 'member-original',
            departmentId: 'SALES',
            isConfidential: false,
          }) as unknown as ReturnType<typeof leadsService.getLeadById> extends Promise<infer U>
            ? U
            : never;

        pbacService.evaluateAccess = async (_t, _r, _resource, action) => {
          if (action === 'reassign') {
            return { allowed: false, effect: 'deny', traces: [] };
          }
          return { allowed: true, effect: 'allow', traces: [] };
        };

        const actor: ActorContext = {
          userId: 'u1',
          memberId: 'm1',
          roleKeys: ['REP'],
          departmentId: 'SALES',
          regionId: null,
        };

        await assert.rejects(
          async () => {
            await leadsService.updateLead(
              'tenant-1',
              'lead-1',
              { assignedMemberId: 'member-target' },
              'u1',
              actor,
              ['role-1'],
              false,
            );
          },
          (err: unknown) => {
            return (
              err instanceof AppError && err.status === 403 && err.message.includes('reassign lead')
            );
          },
        );
      } finally {
        leadsService.getLeadById = origGetLead;
        pbacService.evaluateAccess = origEval;
      }
    });

    it('rejects lead update when proposed merged record violates update policy', async () => {
      const origGetLead = leadsService.getLeadById;
      const origEval = pbacService.evaluateAccess;

      try {
        leadsService.getLeadById = async () =>
          ({
            id: 'lead-2',
            tenantId: 'tenant-1',
            name: 'Lead 2',
            assignedMemberId: 'm1',
            departmentId: 'SALES',
            isConfidential: false,
          }) as unknown as ReturnType<typeof leadsService.getLeadById> extends Promise<infer U>
            ? U
            : never;

        pbacService.evaluateAccess = async (_t, _r, _resource, action, context) => {
          if (action === 'update') {
            // Only allow if resource departmentId is SALES
            const resDept = (context.resource as Record<string, unknown>).departmentId;
            if (resDept !== 'SALES') {
              return { allowed: false, effect: 'deny', traces: [] };
            }
          }
          return { allowed: true, effect: 'allow', traces: [] };
        };

        const actor: ActorContext = {
          userId: 'u1',
          memberId: 'm1',
          roleKeys: ['REP'],
          departmentId: 'SALES',
          regionId: null,
        };

        // Attempt to escalate department to FINANCE
        await assert.rejects(
          async () => {
            await leadsService.updateLead(
              'tenant-1',
              'lead-2',
              { departmentId: 'FINANCE' },
              'u1',
              actor,
              ['role-1'],
              false,
            );
          },
          (err: unknown) => {
            return (
              err instanceof AppError &&
              err.status === 403 &&
              err.message.includes('proposed update violates workspace policy')
            );
          },
        );
      } finally {
        leadsService.getLeadById = origGetLead;
        pbacService.evaluateAccess = origEval;
      }
    });
  });

  describe('4.6 Error Body & Trace Protection', () => {
    it('does not leak policy traces in 403 Forbidden error thrown by requirePolicy', async () => {
      const origEval = pbacService.evaluateAccess;
      try {
        pbacService.evaluateAccess = async () => ({
          allowed: false,
          effect: 'deny',
          traces: [
            {
              policyId: 'pol-secret-123',
              policyName: 'Internal Secret Rule',
              effect: 'deny',
              priority: 1,
              matched: true,
              reason: 'Confidential restriction',
            },
          ],
        });

        const middleware = requirePolicy({
          resource: 'leads',
          action: 'read',
          getTargetResource: () => ({ id: 'lead-1', departmentId: 'HR' }),
        });

        const mockReq = {
          tenant: { id: 'tenant-1' },
          membership: { id: 'm1', roles: ['SALES_REP'], roleIds: ['r1'] },
          user: { id: 'u1' },
          ip: '127.0.0.1',
        } as unknown as Request;

        const mockRes = {} as unknown as Response;
        let caughtError: unknown = null;

        await middleware(mockReq, mockRes, (err?: unknown) => {
          caughtError = err;
        });

        assert.ok(caughtError instanceof AppError);
        assert.equal(caughtError.status, 403);
        assert.equal(caughtError.message, 'Access denied by workspace policy');
        // Details must NOT contain traces
        assert.equal((caughtError as AppError).details, undefined);
      } finally {
        pbacService.evaluateAccess = origEval;
      }
    });
  });

  describe('4.7 Support Session Boundaries', () => {
    it('blocks support session from accessing confidential records when scope is not FULL_ADMIN', async () => {
      const middleware = requirePolicy({
        resource: 'leads',
        action: 'read',
        getTargetResource: () => ({ id: 'lead-conf-1', isConfidential: true }),
      });

      const mockReq = {
        tenant: { id: 'tenant-1' },
        isSupportSession: true,
        supportSession: {
          id: 'ss-1',
          staffId: 'staff-1',
          scope: 'READ_ONLY', // Not FULL_ADMIN
          reason: 'Customer requested troubleshooting',
        },
      } as unknown as Request;

      const mockRes = {} as unknown as Response;
      let caughtError: unknown = null;

      await middleware(mockReq, mockRes, (err?: unknown) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.equal(caughtError.status, 403);
      assert.ok(
        caughtError.message.includes(
          'Confidential records cannot be accessed via standard support sessions',
        ),
      );
    });
  });
});
