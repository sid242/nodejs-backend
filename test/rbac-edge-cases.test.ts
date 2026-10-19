import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db.js';
import { closeRedisClients } from '../src/config/redis.js';
import { rbacRepo } from '../src/modules/rbac/rbac.repository.js';
import * as rbacService from '../src/modules/rbac/rbac.service.js';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository.js';
import * as tenantsService from '../src/modules/tenants/tenants.service.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('deleteTenantRole rejects deleting custom roles that have active members assigned', async () => {
  const tenantId = randomUUID();
  const roleId = randomUUID();

  // Mock findRoleById and countMembersAssignedToRole
  const origFindRole = rbacRepo.findRoleById;
  const origCountMembers = rbacRepo.countMembersAssignedToRole;

  (rbacRepo as any).findRoleById = async (id: string) => ({
    id,
    tenantId,
    name: 'Nurse_Specialist',
    description: 'Custom nursing role',
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Case 1: Role has 3 active members assigned -> MUST FAIL with 400
  (rbacRepo as any).countMembersAssignedToRole = async () => 3;

  await assert.rejects(
    async () => {
      await rbacService.deleteTenantRole(tenantId, roleId);
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('currently assigned to 3 member(s)'));
      return true;
    },
  );

  // Restore mocks
  (rbacRepo as any).findRoleById = origFindRole;
  (rbacRepo as any).countMembersAssignedToRole = origCountMembers;
});

test('updateMemberRole enforces Last-Owner invariant when demoting an owner', async () => {
  const tenantId = randomUUID();
  const operatorUserId = randomUUID();
  const memberId = randomUUID();

  const origFindMember = tenantsRepo.findTenantMemberById;
  const origGetRoles = rbacRepo.getMemberRoles;
  const origCountOwners = rbacRepo.countTenantOwners;

  (tenantsRepo as any).findTenantMemberById = async () => ({
    id: memberId,
    tenantId,
    userId: randomUUID(),
    status: 'ACTIVE',
  });

  // Current member is an OWNER
  (rbacRepo as any).getMemberRoles = async () => [
    {
      id: randomUUID(),
      tenantId,
      name: 'OWNER',
      isSystem: true,
    },
  ];

  // Only 1 owner exists in the tenant
  (rbacRepo as any).countTenantOwners = async () => 1;

  // Attempting to demote to MEMBER must fail with 400
  await assert.rejects(
    async () => {
      await tenantsService.updateMemberRole(tenantId, operatorUserId, memberId, 'MEMBER');
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('Cannot demote the last remaining Owner'));
      return true;
    },
  );

  // Restore mocks
  (tenantsRepo as any).findTenantMemberById = origFindMember;
  (rbacRepo as any).getMemberRoles = origGetRoles;
  (rbacRepo as any).countTenantOwners = origCountOwners;
});

test('updateMemberRole blocks non-owners from promoting members to OWNER', async () => {
  const tenantId = randomUUID();
  const operatorUserId = randomUUID();
  const memberId = randomUUID();

  const origFindMemberById = tenantsRepo.findTenantMemberById;
  const origFindMember = tenantsRepo.findTenantMember;
  const origGetRoles = rbacRepo.getMemberRoles;

  (tenantsRepo as any).findTenantMemberById = async () => ({
    id: memberId,
    tenantId,
    userId: randomUUID(),
    status: 'ACTIVE',
  });

  // Operator is only a standard ADMIN (not an OWNER)
  (tenantsRepo as any).findTenantMember = async () => ({
    id: randomUUID(),
    tenantId,
    userId: operatorUserId,
    status: 'ACTIVE',
  });

  (rbacRepo as any).getMemberRoles = async (_mId: string) => {
    return [{ id: randomUUID(), tenantId, name: 'ADMIN', isSystem: true }];
  };

  // Calling updateMemberRole to promote someone to OWNER must fail with 403 Forbidden
  await assert.rejects(
    async () => {
      await tenantsService.updateMemberRole(tenantId, operatorUserId, memberId, 'OWNER');
    },
    (err: any) => {
      assert.equal(err.status, 403);
      assert.ok(err.message.includes('Only an Owner can grant or revoke the Owner role'));
      return true;
    },
  );

  // Restore mocks
  (tenantsRepo as any).findTenantMemberById = origFindMemberById;
  (tenantsRepo as any).findTenantMember = origFindMember;
  (rbacRepo as any).getMemberRoles = origGetRoles;
});

test('removeMemberFromTenant blocks removing the last remaining OWNER', async () => {
  const tenantId = randomUUID();
  const operatorUserId = randomUUID();
  const memberId = randomUUID();

  const origFindMemberById = tenantsRepo.findTenantMemberById;
  const origGetRoles = rbacRepo.getMemberRoles;
  const origCountOwners = rbacRepo.countTenantOwners;

  (tenantsRepo as any).findTenantMemberById = async () => ({
    id: memberId,
    tenantId,
    userId: randomUUID(), // different from operatorUserId
    status: 'ACTIVE',
  });

  // Member being removed is an OWNER
  (rbacRepo as any).getMemberRoles = async () => [
    { id: randomUUID(), tenantId, name: 'OWNER', isSystem: true },
  ];

  // Only 1 owner remains in tenant
  (rbacRepo as any).countTenantOwners = async () => 1;

  await assert.rejects(
    async () => {
      await tenantsService.removeMemberFromTenant(tenantId, operatorUserId, memberId);
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('Cannot remove the last remaining Owner'));
      return true;
    },
  );

  // Restore mocks
  (tenantsRepo as any).findTenantMemberById = origFindMemberById;
  (rbacRepo as any).getMemberRoles = origGetRoles;
  (rbacRepo as any).countTenantOwners = origCountOwners;
});
