import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { closeDb, db } from '../src/config/db.js';
import { closeRedisClients } from '../src/config/redis.js';
import { users } from '../src/db/schema/index.js';
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

test('createCustomTenantRole and updateCustomTenantRole reject unknown permission keys with 400', async () => {
  const tenantId = randomUUID();
  const roleId = randomUUID();

  const origFindAllPermissions = rbacRepo.findAllPermissions;
  const origFindRoleById = rbacRepo.findRoleById;

  (rbacRepo as any).findAllPermissions = async () => [
    { id: '1', key: 'files:read', name: 'Read files', action: 'read', moduleId: 'm1' },
    { id: '2', key: 'files:write', name: 'Write files', action: 'write', moduleId: 'm1' },
  ];

  (rbacRepo as any).findRoleById = async (id: string) => ({
    id,
    tenantId,
    name: 'CustomRole',
    isSystem: false,
  });

  // 1. Rejects unknown permission in createCustomTenantRole
  await assert.rejects(
    async () => {
      await rbacService.createCustomTenantRole(tenantId, 'Role1', 'desc', [
        'files:read',
        'invalid:unknown:perm',
      ]);
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('Unknown permission key(s): invalid:unknown:perm'));
      return true;
    },
  );

  // 2. Rejects unknown permission in updateCustomTenantRole
  await assert.rejects(
    async () => {
      await rbacService.updateCustomTenantRole(tenantId, roleId, {
        permissions: ['invalid:another:perm'],
      });
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('Unknown permission key(s): invalid:another:perm'));
      return true;
    },
  );

  // Restore mocks
  (rbacRepo as any).findAllPermissions = origFindAllPermissions;
  (rbacRepo as any).findRoleById = origFindRoleById;
});

test('transferTenantOwnership transfers OWNER role and demotes former owner to ADMIN atomically', async () => {
  const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
  let formerOwnerUserId: string = existingUser?.id ?? '';
  if (!formerOwnerUserId) {
    const [created] = await db
      .insert(users)
      .values({
        email: `owner-${Date.now()}@example.com`,
        passwordHash: 'dummyhash',
        name: 'Owner User',
      })
      .returning({ id: users.id });
    formerOwnerUserId = created?.id ?? randomUUID();
  }

  const realTenant = await tenantsRepo.createTenant({
    name: 'Transfer Tenant',
    slug: `transfer-${Date.now()}`,
    plan: 'FREE',
  });
  const tenantId = realTenant.id;
  const formerOwnerMemberId = randomUUID();
  const newOwnerUserId = randomUUID();
  const newOwnerMemberId = randomUUID();

  const origFindMemberById = tenantsRepo.findTenantMemberById;
  const origFindMember = tenantsRepo.findTenantMember;
  const origGetMemberRoles = rbacRepo.getMemberRoles;
  const origFindRolesByTenant = rbacRepo.findRolesByTenant;
  const origAssignRole = rbacRepo.assignRoleToMember;
  const origRemoveRole = rbacRepo.removeRoleFromMember;

  const assignedRoles: { memberId: string; roleId: string }[] = [];
  const removedRoles: { memberId: string; roleId: string }[] = [];

  const ownerRoleId = 'role-owner-id';
  const adminRoleId = 'role-admin-id';

  (tenantsRepo as any).findTenantMemberById = async (id: string) => {
    if (id === newOwnerMemberId) {
      return { id: newOwnerMemberId, tenantId, userId: newOwnerUserId, status: 'ACTIVE' };
    }
    return null;
  };

  (tenantsRepo as any).findTenantMember = async (tId: string, uId: string) => {
    if (tId === tenantId && uId === formerOwnerUserId) {
      return { id: formerOwnerMemberId, tenantId, userId: formerOwnerUserId, status: 'ACTIVE' };
    }
    return null;
  };

  (rbacRepo as any).getMemberRoles = async (memberId: string) => {
    if (memberId === formerOwnerMemberId) {
      return [{ id: ownerRoleId, name: 'OWNER' }];
    }
    return [{ id: adminRoleId, name: 'ADMIN' }];
  };

  (rbacRepo as any).findRolesByTenant = async () => [
    { id: ownerRoleId, name: 'OWNER' },
    { id: adminRoleId, name: 'ADMIN' },
  ];

  (rbacRepo as any).assignRoleToMember = async (memberId: string, roleId: string) => {
    assignedRoles.push({ memberId, roleId });
  };

  (rbacRepo as any).removeRoleFromMember = async (memberId: string, roleId: string) => {
    removedRoles.push({ memberId, roleId });
  };

  // Case 1: Cannot transfer to yourself
  await assert.rejects(
    async () => {
      await tenantsService.transferTenantOwnership(
        tenantId,
        formerOwnerUserId,
        formerOwnerMemberId,
      );
    },
    (err: any) => {
      assert.equal(err.status, 404);
      return true;
    },
  );

  // Case 2: Successful ownership transfer
  const result = await tenantsService.transferTenantOwnership(
    tenantId,
    formerOwnerUserId,
    newOwnerMemberId,
    'ADMIN',
  );

  assert.equal(result.newOwnerId, newOwnerUserId);
  assert.equal(result.formerOwnerRole, 'ADMIN');
  assert.ok(assignedRoles.some((r) => r.memberId === newOwnerMemberId && r.roleId === ownerRoleId));
  assert.ok(
    assignedRoles.some((r) => r.memberId === formerOwnerMemberId && r.roleId === adminRoleId),
  );

  // Restore mocks
  (tenantsRepo as any).findTenantMemberById = origFindMemberById;
  (tenantsRepo as any).findTenantMember = origFindMember;
  (rbacRepo as any).getMemberRoles = origGetMemberRoles;
  (rbacRepo as any).findRolesByTenant = origFindRolesByTenant;
  (rbacRepo as any).assignRoleToMember = origAssignRole;
  (rbacRepo as any).removeRoleFromMember = origRemoveRole;
});
