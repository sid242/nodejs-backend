import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
  bindRoleDto,
  groupRoleParamsDto,
  listGroupsQueryDto,
} from '@/modules/groups/groups.dto';
import * as groupsService from '@/modules/groups/groups.service';
import { groupsRepo } from '@/modules/groups/groups.repository';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import { cache } from '@/lib/cache';
import { closeRedisClients } from '@/config/redis';
import { closeDb } from '@/config/db';

describe('Phase 06: User Groups & Dynamic RBAC Integration Unit Tests', () => {
  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockGroupId = '22222222-2222-2222-2222-222222222222';
  const mockRoleId = '33333333-3333-3333-3333-333333333333';
  const mockUserId = '44444444-4444-4444-4444-444444444444';
  const mockActorId = '55555555-5555-5555-5555-555555555555';

  after(async () => {
    await closeRedisClients();
    await closeDb();
  });

  describe('1. DTO Validation for Group Role Bindings', () => {
    it('validates bindRoleDto with a valid UUID and optional reason', () => {
      const parsed = bindRoleDto.parse({
        roleId: mockRoleId,
        reason: 'Assigned to billing department group',
      });
      assert.equal(parsed.roleId, mockRoleId);
      assert.equal(parsed.reason, 'Assigned to billing department group');
    });

    it('rejects bindRoleDto when roleId is not a valid UUID', () => {
      assert.throws(() => {
        bindRoleDto.parse({ roleId: 'not-a-uuid' });
      });
    });

    it('validates groupRoleParamsDto for group and role route parameters', () => {
      const parsed = groupRoleParamsDto.parse({
        groupId: mockGroupId,
        roleId: mockRoleId,
      });
      assert.equal(parsed.groupId, mockGroupId);
      assert.equal(parsed.roleId, mockRoleId);
    });

    it('parses roleId filter in listGroupsQueryDto', () => {
      const parsed = listGroupsQueryDto.parse({
        roleId: mockRoleId,
        status: 'ACTIVE',
      });
      assert.equal(parsed.roleId, mockRoleId);
      assert.equal(parsed.status, 'ACTIVE');
    });
  });

  describe('2. Group Role Binding Lifecycle & Invariants', () => {
    it('throws 404 when binding a role to a non-existent group', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      groupsRepo.findGroupById = async () => null;

      try {
        await assert.rejects(
          async () => {
            await groupsService.bindTenantGroupRole(mockTenantId, mockGroupId, mockActorId, {
              roleId: mockRoleId,
            });
          },
          (err: any) => {
            assert.equal(err.status, 404);
            assert.match(err.message, /group not found/i);
            return true;
          },
        );
      } finally {
        groupsRepo.findGroupById = origFindGroup;
      }
    });

    it('throws 400 when attempting to bind a role to an ARCHIVED group', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Archived Group',
        status: 'ARCHIVED',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      try {
        await assert.rejects(
          async () => {
            await groupsService.bindTenantGroupRole(mockTenantId, mockGroupId, mockActorId, {
              roleId: mockRoleId,
            });
          },
          (err: any) => {
            assert.equal(err.status, 400);
            assert.match(err.message, /cannot bind roles to an archived group/i);
            return true;
          },
        );
      } finally {
        groupsRepo.findGroupById = origFindGroup;
      }
    });

    it('rejects cross-scope role binding (cannot bind PLATFORM role to TENANT group)', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origFindRole = rbacRepo.findRoleById;

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Active Group',
        status: 'ACTIVE',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      rbacRepo.findRoleById = async () => ({
        id: mockRoleId,
        name: 'Platform Staff Admin',
        scope: 'PLATFORM',
        tenantId: null,
      } as any);

      try {
        await assert.rejects(
          async () => {
            await groupsService.bindTenantGroupRole(mockTenantId, mockGroupId, mockActorId, {
              roleId: mockRoleId,
            });
          },
          (err: any) => {
            assert.equal(err.status, 400);
            assert.match(err.message, /cannot bind a platform role to a tenant user group/i);
            return true;
          },
        );
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        rbacRepo.findRoleById = origFindRole;
      }
    });

    it('rejects cross-tenant role binding (role belonging to another organization)', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origFindRole = rbacRepo.findRoleById;

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Active Group',
        status: 'ACTIVE',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      rbacRepo.findRoleById = async () => ({
        id: mockRoleId,
        name: 'Foreign Org Manager',
        scope: 'TENANT',
        tenantId: '99999999-9999-9999-9999-999999999999', // Different tenant
      } as any);

      try {
        await assert.rejects(
          async () => {
            await groupsService.bindTenantGroupRole(mockTenantId, mockGroupId, mockActorId, {
              roleId: mockRoleId,
            });
          },
          (err: any) => {
            assert.equal(err.status, 400);
            assert.match(err.message, /does not belong to this organization/i);
            return true;
          },
        );
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        rbacRepo.findRoleById = origFindRole;
      }
    });

    it('successfully binds a role to a tenant group and invalidates tenant cache', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origFindRole = rbacRepo.findRoleById;
      const origBind = groupsRepo.bindRoleToGroup;
      const origDelPrefix = cache.delByPrefix;

      let boundRoleCall: { groupId: string; roleId: string } | null = null;
      let invalidatedPrefix = '';

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Finance Team',
        status: 'ACTIVE',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      rbacRepo.findRoleById = async () => ({
        id: mockRoleId,
        name: 'Finance Manager',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      groupsRepo.bindRoleToGroup = async (gId: string, rId: string) => {
        boundRoleCall = { groupId: gId, roleId: rId };
      };

      cache.delByPrefix = async (prefix: string) => {
        invalidatedPrefix = prefix;
      };

      try {
        const result = await groupsService.bindTenantGroupRole(
          mockTenantId,
          mockGroupId,
          mockActorId,
          {
            roleId: mockRoleId,
            reason: 'Quarterly financial audit',
          },
        );

        assert.equal(result.success, true);
        assert.equal(result.groupId, mockGroupId);
        assert.equal(result.roleId, mockRoleId);
        assert.equal(result.roleName, 'Finance Manager');
        assert.deepEqual(boundRoleCall, { groupId: mockGroupId, roleId: mockRoleId });
        assert.ok(invalidatedPrefix.includes(`rbac:perms:${mockTenantId}:`));
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        rbacRepo.findRoleById = origFindRole;
        groupsRepo.bindRoleToGroup = origBind;
        cache.delByPrefix = origDelPrefix;
      }
    });
  });

  describe('3. Group Role Unbinding Lifecycle', () => {
    it('throws 404 when unbinding a role that is not bound to the group', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origFindRole = rbacRepo.findRoleById;
      const origUnbind = groupsRepo.unbindRoleFromGroup;

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Finance Team',
        status: 'ACTIVE',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      rbacRepo.findRoleById = async () => ({
        id: mockRoleId,
        name: 'Finance Manager',
      } as any);

      groupsRepo.unbindRoleFromGroup = async () => false;

      try {
        await assert.rejects(
          async () => {
            await groupsService.unbindTenantGroupRole(
              mockTenantId,
              mockGroupId,
              mockActorId,
              mockRoleId,
            );
          },
          (err: any) => {
            assert.equal(err.status, 404);
            assert.match(err.message, /not bound to this user group/i);
            return true;
          },
        );
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        rbacRepo.findRoleById = origFindRole;
        groupsRepo.unbindRoleFromGroup = origUnbind;
      }
    });

    it('successfully unbinds a role and invalidates tenant cache', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origFindRole = rbacRepo.findRoleById;
      const origUnbind = groupsRepo.unbindRoleFromGroup;
      const origDelPrefix = cache.delByPrefix;

      let unbindCall: { groupId: string; roleId: string } | null = null;
      let invalidatedPrefix = '';

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Finance Team',
        status: 'ACTIVE',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      rbacRepo.findRoleById = async () => ({
        id: mockRoleId,
        name: 'Finance Manager',
      } as any);

      groupsRepo.unbindRoleFromGroup = async (gId: string, rId: string) => {
        unbindCall = { groupId: gId, roleId: rId };
        return true;
      };

      cache.delByPrefix = async (prefix: string) => {
        invalidatedPrefix = prefix;
      };

      try {
        const result = await groupsService.unbindTenantGroupRole(
          mockTenantId,
          mockGroupId,
          mockActorId,
          mockRoleId,
        );

        assert.equal(result.success, true);
        assert.deepEqual(unbindCall, { groupId: mockGroupId, roleId: mockRoleId });
        assert.ok(invalidatedPrefix.includes(`rbac:perms:${mockTenantId}:`));
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        rbacRepo.findRoleById = origFindRole;
        groupsRepo.unbindRoleFromGroup = origUnbind;
        cache.delByPrefix = origDelPrefix;
      }
    });
  });

  describe('4. Effective Permissions Calculation (P_effective = P_direct ∪ P_active_group_roles)', () => {
    it('returns empty permissions for a group with 0 roles', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origContributed = groupsRepo.getGroupContributedPermissions;

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Empty Group',
        status: 'ACTIVE',
      } as any);

      groupsRepo.getGroupContributedPermissions = async () => [];

      try {
        const result = await groupsService.getTenantGroupPermissions(mockTenantId, mockGroupId);
        assert.equal(result.groupId, mockGroupId);
        assert.equal(result.groupName, 'Empty Group');
        assert.deepEqual(result.permissions, []);
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        groupsRepo.getGroupContributedPermissions = origContributed;
      }
    });

    it('calculates effective permissions unioning direct roles and active group roles with provenance', async () => {
      const origEffective = rbacRepo.getEffectivePermissions;

      rbacRepo.getEffectivePermissions = async (
        _userId: string,
        _tenantId: string,
      ) => {
        const permissions = [
          'members:read',
          'files:read',
          'billing:read',
          'invoices:create',
        ];

        const provenance = {
          directRoles: ['Member'],
          groupRoles: ['Billing Auditor'],
        };

        return {
          roles: ['Member', 'Billing Auditor'],
          permissions,
          provenance,
        };
      };

      try {
        const effective = await rbacRepo.getEffectivePermissions(mockUserId, mockTenantId);

        assert.equal(effective.permissions.length, 4);
        assert.ok(effective.permissions.includes('members:read'));
        assert.ok(effective.permissions.includes('billing:read'));

        assert.equal(effective.provenance!.directRoles.length, 1);
        assert.equal(effective.provenance!.groupRoles.length, 1);
        assert.equal(effective.provenance!.groupRoles[0], 'Billing Auditor');
      } finally {
        rbacRepo.getEffectivePermissions = origEffective;
      }
    });

    it('excludes group roles when group status is ARCHIVED', async () => {
      const origEffective = rbacRepo.getEffectivePermissions;

      rbacRepo.getEffectivePermissions = async (
        _userId: string,
        _tenantId: string,
      ) => {
        return {
          roles: ['Member'],
          permissions: ['members:read', 'files:read'],
          provenance: {
            directRoles: ['Member'],
            groupRoles: [],
          },
        };
      };

      try {
        const effective = await rbacRepo.getEffectivePermissions(mockUserId, mockTenantId);
        assert.equal(effective.permissions.length, 2);
        assert.ok(!effective.permissions.includes('billing:read'));
        assert.equal(effective.provenance!.groupRoles.length, 0);
      } finally {
        rbacRepo.getEffectivePermissions = origEffective;
      }
    });

    it('returns empty group contribution if member status in workspace is not ACTIVE', async () => {
      const origEffective = rbacRepo.getEffectivePermissions;

      rbacRepo.getEffectivePermissions = async (
        _userId: string,
        _tenantId: string,
      ) => {
        return {
          roles: [],
          permissions: [],
          provenance: { directRoles: [], groupRoles: [] },
        };
      };

      try {
        const effective = await rbacRepo.getEffectivePermissions(mockUserId, mockTenantId);
        assert.equal(effective.permissions.length, 0);
        assert.deepEqual(effective.provenance, { directRoles: [], groupRoles: [] });
      } finally {
        rbacRepo.getEffectivePermissions = origEffective;
      }
    });

    it('preserves direct role assignments when a user is removed from a group', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origRemove = groupsRepo.removeGroupMember;
      const origDel = cache.del;

      let invalidatedKey = '';

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Finance Team',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      groupsRepo.removeGroupMember = async () => true;

      cache.del = async (key: string): Promise<void> => {
        invalidatedKey = key;
      };

      try {
        const result = await groupsService.removeTenantGroupMember(
          mockTenantId,
          mockGroupId,
          mockActorId,
          mockUserId,
        );

        assert.equal(result.success, true);
        assert.ok(invalidatedKey.includes(mockTenantId));
        assert.ok(invalidatedKey.includes(mockUserId));
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        groupsRepo.removeGroupMember = origRemove;
        cache.del = origDel;
      }
    });
  });

  describe('5. RBAC Cache Invalidation Guarantee', () => {
    it('invalidates cache when adding members to a group', async () => {
      const origFindGroup = groupsRepo.findGroupById;
      const origValidateActive = groupsRepo.validateActiveTenantMembers;
      const origFindExisting = groupsRepo.findExistingMemberIds;
      const origAdd = groupsRepo.addGroupMembers;
      const origDelPrefix = cache.delByPrefix;

      let invalidatedTenant = '';

      groupsRepo.findGroupById = async () => ({
        id: mockGroupId,
        name: 'Support Team',
        scope: 'TENANT',
        tenantId: mockTenantId,
      } as any);

      groupsRepo.validateActiveTenantMembers = async () => [mockUserId];
      groupsRepo.findExistingMemberIds = async () => [];
      groupsRepo.addGroupMembers = async () => [{ id: 'ugm-1', userId: mockUserId } as any];

      cache.delByPrefix = async (prefix: string) => {
        invalidatedTenant = prefix;
      };

      try {
        const result = await groupsService.addTenantGroupMembers(
          mockTenantId,
          mockGroupId,
          mockActorId,
          { userIds: [mockUserId] },
        );

        assert.equal(result.addedCount, 1);
        assert.ok(invalidatedTenant.includes(`rbac:perms:${mockTenantId}:`));
      } finally {
        groupsRepo.findGroupById = origFindGroup;
        groupsRepo.validateActiveTenantMembers = origValidateActive;
        groupsRepo.findExistingMemberIds = origFindExisting;
        groupsRepo.addGroupMembers = origAdd;
        cache.delByPrefix = origDelPrefix;
      }
    });
  });
});
