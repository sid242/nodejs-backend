import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import { Policy } from '@/db/schema/access/policies';
import { createLeadDto, listLeadsQueryDto, updateLeadDto } from '@/modules/leads/leads.dto';
import { evaluatePolicies } from '@/modules/pbac/pbac.evaluator';
import { requirePolicy } from '@/modules/pbac/pbac.middleware';
import {
  createPolicyDto,
  listPoliciesQueryDto,
  updatePolicyDto,
} from '@/modules/policies/policies.dto';

describe('Phase 15: Policy-Based Authorization (PBAC) Unit Tests', () => {
  describe('1. Policies DTO Validation', () => {
    it('validates valid createPolicyDto', () => {
      const parsed = createPolicyDto.parse({
        name: 'Sales Rep Regional Scope',
        resource: 'leads',
        action: 'read',
        effect: 'allow',
        conditions: {
          attribute: 'resource.regionId',
          operator: '$eq',
          value: 'actor.regionId',
        },
      });

      assert.equal(parsed.name, 'Sales Rep Regional Scope');
      assert.equal(parsed.resource, 'leads');
      assert.equal(parsed.action, 'read');
      assert.equal(parsed.effect, 'allow');
      assert.equal(parsed.priority, 0);
      assert.equal(parsed.isActive, true);
    });

    it('rejects createPolicyDto when missing required fields', () => {
      assert.throws(() => {
        createPolicyDto.parse({
          name: 'Incomplete',
        });
      });
    });

    it('validates updatePolicyDto with partial fields', () => {
      const parsed = updatePolicyDto.parse({
        isActive: false,
        priority: 50,
      });

      assert.equal(parsed.isActive, false);
      assert.equal(parsed.priority, 50);
      assert.equal(parsed.name, undefined);
    });

    it('validates listPoliciesQueryDto defaults and search query', () => {
      const parsed = listPoliciesQueryDto.parse({
        resource: 'leads',
        search: 'Regional',
      });

      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
      assert.equal(parsed.resource, 'leads');
      assert.equal(parsed.search, 'Regional');
    });
  });

  describe('2. Leads DTO Validation', () => {
    it('validates valid createLeadDto with defaults', () => {
      const parsed = createLeadDto.parse({
        name: 'Acme Corp',
        email: 'contact@acme.com',
      });

      assert.equal(parsed.name, 'Acme Corp');
      assert.equal(parsed.email, 'contact@acme.com');
      assert.equal(parsed.status, 'new');
      assert.equal(parsed.value, 0);
      assert.equal(parsed.isConfidential, false);
    });

    it('rejects invalid email in createLeadDto', () => {
      assert.throws(() => {
        createLeadDto.parse({
          name: 'Invalid Email Lead',
          email: 'not-an-email',
        });
      });
    });

    it('validates updateLeadDto optional null assignedMemberId', () => {
      const parsed = updateLeadDto.parse({
        status: 'qualified',
        assignedMemberId: null,
      });

      assert.equal(parsed.status, 'qualified');
      assert.equal(parsed.assignedMemberId, null);
    });

    it('validates listLeadsQueryDto with status filter', () => {
      const parsed = listLeadsQueryDto.parse({
        status: 'proposal',
        page: 2,
        limit: 10,
      });

      assert.equal(parsed.status, 'proposal');
      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 10);
    });
  });

  describe('3. PBAC Middleware Invariants', () => {
    it('bypasses policy check for OWNER role', async () => {
      const middleware = requirePolicy({
        resource: 'leads',
        action: 'read',
      });

      let nextCalled = false;
      const mockReq: any = {
        tenant: { id: 'tenant-123' },
        membership: { roles: ['OWNER'], id: 'member-123' },
      };
      const mockRes: any = {};
      const next = (err?: any) => {
        if (!err) nextCalled = true;
      };

      await middleware(mockReq, mockRes, next);
      assert.equal(nextCalled, true);
    });

    it('bypasses policy check for platform support session', async () => {
      const middleware = requirePolicy({
        resource: 'leads',
        action: 'read',
      });

      let nextCalled = false;
      const mockReq: any = {
        tenant: { id: 'tenant-123' },
        isSupportSession: true,
      };
      const mockRes: any = {};
      const next = (err?: any) => {
        if (!err) nextCalled = true;
      };

      await middleware(mockReq, mockRes, next);
      assert.equal(nextCalled, true);
    });

    it('attaches actorContext to request for regular member', async () => {
      const middleware = requirePolicy({
        resource: 'leads',
        action: 'read',
      });

      let nextCalled = false;
      const mockReq: any = {
        tenant: { id: 'tenant-123' },
        user: { id: 'user-abc' },
        membership: {
          id: 'member-abc',
          roles: ['SALES_REP'],
          roleIds: ['role-abc'],
        },
      };
      const mockRes: any = {};
      const next = (err?: any) => {
        if (!err) nextCalled = true;
      };

      await middleware(mockReq, mockRes, next);
      assert.equal(nextCalled, true);
      assert.ok(mockReq.actorContext);
      assert.equal(mockReq.actorContext.userId, 'user-abc');
      assert.equal(mockReq.actorContext.memberId, 'member-abc');
      assert.deepEqual(mockReq.actorContext.roleKeys, ['SALES_REP']);
    });
  });

  describe('4. Real-world CRM Policy Evaluation Scenarios', () => {
    const actor = {
      userId: 'user-001',
      memberId: 'member-001',
      roleKeys: ['SALES_REP'],
      departmentId: 'sales-enterprise',
      regionId: 'apac',
    };

    it('Scenario: Sales Rep can only access leads assigned to them', () => {
      const repPolicy: Policy = {
        id: 'p-rep',
        tenantId: 'tenant-1',
        name: 'Sales Rep Lead Ownership',
        description: null,
        resource: 'leads',
        action: 'read',
        effect: 'allow',
        priority: 10,
        isActive: true,
        conditions: {
          attribute: 'resource.assignedMemberId',
          operator: '$eq',
          value: 'actor.memberId',
        },
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Allowed for assigned lead
      const myLead = evaluatePolicies([repPolicy], {
        actor,
        resource: { assignedMemberId: 'member-001', name: 'My Deal' },
      });
      assert.equal(myLead.allowed, true);

      // Denied for colleague's lead
      const otherLead = evaluatePolicies([repPolicy], {
        actor,
        resource: { assignedMemberId: 'member-999', name: 'Other Deal' },
      });
      assert.equal(otherLead.allowed, false);
    });

    it('Scenario: Confidential lead deny policy overrides manager allow policy', () => {
      const managerAllowPolicy: Policy = {
        id: 'p-mgr',
        tenantId: 'tenant-1',
        name: 'Manager Department Access',
        description: null,
        resource: 'leads',
        action: 'read',
        effect: 'allow',
        priority: 10,
        isActive: true,
        conditions: {
          attribute: 'resource.departmentId',
          operator: '$eq',
          value: 'actor.departmentId',
        },
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const confidentialDenyPolicy: Policy = {
        id: 'p-deny-confidential',
        tenantId: 'tenant-1',
        name: 'Block Confidential Leads',
        description: null,
        resource: 'leads',
        action: 'read',
        effect: 'deny',
        priority: 100,
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

      const policies = [managerAllowPolicy, confidentialDenyPolicy];

      // Regular lead in same department -> ALLOW
      const normalDeal = evaluatePolicies(policies, {
        actor,
        resource: { departmentId: 'sales-enterprise', isConfidential: false },
      });
      assert.equal(normalDeal.allowed, true);

      // Confidential deal in same department -> DENY
      const confidentialDeal = evaluatePolicies(policies, {
        actor,
        resource: { departmentId: 'sales-enterprise', isConfidential: true },
      });
      assert.equal(confidentialDeal.allowed, false);
      assert.equal(confidentialDeal.effect, 'deny');
    });
  });

  after(async () => {
    await Promise.allSettled([closeRedisClients(), closeDb()]);
  });
});
