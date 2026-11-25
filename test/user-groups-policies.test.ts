import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import type { Policy, UserGroup } from '@/db/schema';
import { cache } from '@/lib/cache';
import { bindPolicyDto, groupPolicyParamsDto } from '@/modules/groups/groups.dto';
import { groupsRepo } from '@/modules/groups/groups.repository';
import * as groupsService from '@/modules/groups/groups.service';
import { isValidAttributePath, PBAC_REGISTRY } from '@/modules/pbac/pbac.registry';
import { pbacService } from '@/modules/pbac/pbac.service';
import { policiesRepo } from '@/modules/policies/policies.repository';

describe('User Group Permissions & Policy Improvements', () => {
  const mockTenantId = '11111111-1111-4111-8111-111111111111';
  const mockGroupId = '22222222-2222-4222-8222-222222222222';
  const mockPolicyId = '33333333-3333-4333-8333-333333333333';
  const mockRoleId = '44444444-4444-4444-8444-444444444444';
  const mockActorId = '55555555-5555-4555-8555-555555555555';

  after(async () => {
    await closeRedisClients();
    await closeDb();
  });

  it('validates bindPolicyDto and groupPolicyParamsDto', () => {
    const valid = bindPolicyDto.parse({
      policyIds: [mockPolicyId],
      reason: 'Grant regional access policy',
    });
    assert.deepEqual(valid.policyIds, [mockPolicyId]);
    assert.equal(
      groupPolicyParamsDto.parse({ groupId: mockGroupId, policyId: mockPolicyId }).policyId,
      mockPolicyId,
    );
    assert.throws(() => bindPolicyDto.parse({ policyIds: [] }));
  });

  it('exposes actor.groupIds and actor.groupSlugs in PBAC registry', () => {
    const paths = PBAC_REGISTRY.commonActorAttributes.map((a) => a.path);
    assert.ok(paths.includes('actor.groupIds'));
    assert.ok(paths.includes('actor.groupSlugs'));
    assert.equal(isValidAttributePath('leads', 'actor.groupIds'), true);
    assert.equal(isValidAttributePath('leads', 'actor.groupSlugs'), true);
  });

  it('invalidates RBAC & PBAC cache when archiving a tenant group', async () => {
    const origFind = groupsRepo.findGroupById;
    const origArchive = groupsRepo.archiveGroup;
    const origDelPrefix = cache.delByPrefix.bind(cache);
    const prefixes: string[] = [];

    const baseGroup: UserGroup & { memberCount: number } = {
      id: mockGroupId,
      name: 'Sales Ops',
      slug: 'sales-ops',
      description: null,
      status: 'ACTIVE',
      scope: 'TENANT',
      tenantId: mockTenantId,
      createdBy: null,
      updatedBy: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      memberCount: 0,
    };

    groupsRepo.findGroupById = async () => baseGroup;
    groupsRepo.archiveGroup = async () => ({
      ...baseGroup,
      status: 'ARCHIVED',
      archivedAt: new Date(),
    });
    cache.delByPrefix = async (prefix: string) => {
      prefixes.push(prefix);
    };

    try {
      await groupsService.archiveTenantGroup(mockTenantId, mockGroupId, mockActorId);
      assert.ok(prefixes.includes(`rbac:perms:${mockTenantId}:`));
      assert.ok(prefixes.includes(`pbac:role:${mockTenantId}:`));
      assert.ok(prefixes.includes(`pbac:group:${mockTenantId}:`));
    } finally {
      groupsRepo.findGroupById = origFind;
      groupsRepo.archiveGroup = origArchive;
      cache.delByPrefix = origDelPrefix;
    }
  });

  it('merges direct group policies alongside role policies in pbacService.getEffectivePolicies', async () => {
    const origRolePolicies = pbacService.getPoliciesForRole.bind(pbacService);
    const origGroupPolicies = pbacService.getPoliciesForGroup.bind(pbacService);

    pbacService.getPoliciesForRole = async () => [
      {
        id: mockPolicyId,
        tenantId: mockTenantId,
        name: 'Role Policy',
        description: null,
        resource: 'leads',
        action: 'read',
        effect: 'allow',
        conditions: { always: true },
        isActive: true,
        priority: 10,
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    pbacService.getPoliciesForGroup = async () => [
      {
        id: '77777777-7777-4777-8777-777777777777',
        tenantId: mockTenantId,
        name: 'Group Deny Policy',
        description: null,
        resource: 'leads',
        action: '*',
        effect: 'deny',
        conditions: { attribute: 'resource.isConfidential', operator: '$eq', value: true },
        isActive: true,
        priority: 100,
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    try {
      const effective = await pbacService.getEffectivePolicies(
        mockTenantId,
        [mockRoleId],
        'leads',
        'read',
        [mockGroupId],
      );
      assert.equal(effective.length, 2);
      assert.ok(effective.some((p) => p.name === 'Group Deny Policy'));
    } finally {
      pbacService.getPoliciesForRole = origRolePolicies;
      pbacService.getPoliciesForGroup = origGroupPolicies;
    }
  });

  it('binds and unbinds policies on tenant and platform user groups cleanly', async () => {
    const origFindGroup = groupsRepo.findGroupById;
    const origFindTenantPolicy = policiesRepo.findPolicyById.bind(policiesRepo);
    const origFindPlatformPolicy = policiesRepo.findPlatformPolicyById.bind(policiesRepo);
    const origBindPolicy = groupsRepo.bindPolicyToGroup;

    const boundCalls: Array<{ groupId: string; policyId: string; tenantId?: string }> = [];

    const basePolicy: Policy = {
      id: mockPolicyId,
      tenantId: mockTenantId,
      name: 'Tenant Policy',
      description: null,
      resource: 'leads',
      action: 'read',
      effect: 'allow',
      conditions: { always: true },
      isActive: true,
      priority: 50,
      createdBy: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    groupsRepo.findGroupById = async (_id: string, scope: 'PLATFORM' | 'TENANT') => ({
      id: mockGroupId,
      name: 'Security Cohort',
      slug: 'security-cohort',
      description: null,
      status: 'ACTIVE',
      scope,
      tenantId: scope === 'TENANT' ? mockTenantId : null,
      createdBy: null,
      updatedBy: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      memberCount: 0,
    });
    policiesRepo.findPolicyById = async () => basePolicy;
    policiesRepo.findPlatformPolicyById = async () => ({
      ...basePolicy,
      name: 'Platform Policy',
      tenantId: null,
    });
    groupsRepo.bindPolicyToGroup = async (groupId: string, policyId: string, tenantId?: string) => {
      boundCalls.push({ groupId, policyId, tenantId });
    };

    try {
      await groupsService.bindTenantGroupPolicy(mockTenantId, mockGroupId, mockActorId, {
        policyIds: [mockPolicyId],
      });
      await groupsService.bindPlatformGroupPolicy(mockGroupId, mockActorId, {
        policyIds: [mockPolicyId],
      });
      assert.equal(boundCalls.length, 2);
      assert.equal(boundCalls[0]?.tenantId, mockTenantId);
      assert.equal(boundCalls[1]?.tenantId, undefined);
    } finally {
      groupsRepo.findGroupById = origFindGroup;
      policiesRepo.findPolicyById = origFindTenantPolicy;
      policiesRepo.findPlatformPolicyById = origFindPlatformPolicy;
      groupsRepo.bindPolicyToGroup = origBindPolicy;
    }
  });
});
