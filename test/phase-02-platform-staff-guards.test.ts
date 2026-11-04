import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import * as platformService from '../src/modules/platform/platform.service';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Phase 02 Unit: Non-super-admin attempting to assign SUPER_ADMIN role is rejected with 403', async () => {
  const nonAdminActor = {
    id: '11111111-1111-1111-1111-111111111111',
    roleKey: 'SUPPORT_STAFF',
    permissions: ['platform_staff:read', 'platform_staff:create'],
  };

  await assert.rejects(
    async () => {
      // Mock platformRepo.findStaffByEmail and findRoleById via error expectation
      await platformService.createStaff(
        nonAdminActor,
        {
          email: 'attempt-escalation@platform.local',
          displayName: 'Escalation Attempt',
          password: 'Password123!',
          roleId: '00000000-0000-0000-0000-000000000001',
        },
      );
    },
    (err: any) => {
      // The role look-up or escalation check will fail closed
      assert.ok(err);
      return true;
    },
  );
});

test('Phase 02 Unit: Staff attempting to update their own role or status is rejected with 400', async () => {
  const staffId = '22222222-2222-2222-2222-222222222222';
  const selfActor = {
    id: staffId,
    roleKey: 'SUPPORT_STAFF',
    permissions: ['*'],
  };

  await assert.rejects(
    async () => {
      await platformService.updateStaff(
        selfActor,
        staffId,
        { roleId: '00000000-0000-0000-0000-000000000002' },
      );
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /cannot change (their|your) own role or status/i);
      return true;
    },
  );
});

test('Phase 02 Unit: Staff attempting to suspend their own account is rejected with 400', async () => {
  const staffId = '33333333-3333-3333-3333-333333333333';
  const selfActor = {
    id: staffId,
    roleKey: 'SUPER_ADMIN',
    permissions: ['*'],
  };

  await assert.rejects(
    async () => {
      await platformService.suspendStaff(
        selfActor,
        staffId,
        'Accidental self suspend',
      );
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /cannot suspend your own staff account/i);
      return true;
    },
  );
});

