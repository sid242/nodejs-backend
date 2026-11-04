import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import { publicPlatformStaff } from '../src/db/schema/platform/platform-staff';
import {
  acceptStaffInviteDto,
  inviteStaffDto,
  listStaffQueryDto,
} from '../src/modules/platform/platform.dto';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Phase 02 Unit: listStaffQueryDto parses search, department, and pagination filters', () => {
  const parsed = listStaffQueryDto.parse({
    page: '2',
    limit: '50',
    search: 'john doe',
    department: 'DevOps',
    employeeCode: 'EMP-001',
    status: 'ACTIVE',
    sortBy: 'displayName',
    sortOrder: 'asc',
  });

  assert.equal(parsed.page, 2);
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.search, 'john doe');
  assert.equal(parsed.department, 'DevOps');
  assert.equal(parsed.employeeCode, 'EMP-001');
  assert.equal(parsed.status, 'ACTIVE');
  assert.equal(parsed.sortBy, 'displayName');
  assert.equal(parsed.sortOrder, 'asc');
});

test('Phase 02 Unit: inviteStaffDto validates required email, name, role and optional metadata', () => {
  const roleId = '00000000-0000-0000-0000-000000000001';

  // Valid invite input
  const valid = inviteStaffDto.parse({
    email: 'newstaff@platform.local',
    displayName: 'New Staff',
    roleId,
    employeeCode: 'EMP-100',
    department: 'Engineering',
    jobTitle: 'Site Reliability Engineer',
    invitationMessage: 'Welcome to our platform operations team!',
  });
  assert.equal(valid.email, 'newstaff@platform.local');
  assert.equal(valid.employeeCode, 'EMP-100');
  assert.equal(valid.department, 'Engineering');

  // Invalid email rejected
  assert.throws(() => {
    inviteStaffDto.parse({
      email: 'not-an-email',
      displayName: 'Invalid',
      roleId,
    });
  });

  // Missing roleId rejected
  assert.throws(() => {
    inviteStaffDto.parse({
      email: 'valid@example.com',
      displayName: 'No Role',
    });
  });
});

test('Phase 02 Unit: acceptStaffInviteDto enforces token and minimum password length', () => {
  const valid = acceptStaffInviteDto.parse({
    token: '12345678901234567890',
    password: 'SecurePassword123!',
  });
  assert.equal(valid.token, '12345678901234567890');

  // Short password rejected
  assert.throws(() => {
    acceptStaffInviteDto.parse({
      token: '12345678901234567890',
      password: 'short',
    });
  });

  // Short token rejected
  assert.throws(() => {
    acceptStaffInviteDto.parse({
      token: 'short',
      password: 'SecurePassword123!',
    });
  });
});

test('Phase 02 Unit: publicPlatformStaff projection protects sensitive authentication fields', () => {
  const exposedKeys = Object.keys(publicPlatformStaff);

  // Must include metadata and identity link
  assert.ok(exposedKeys.includes('id'));
  assert.ok(exposedKeys.includes('userId'));
  assert.ok(exposedKeys.includes('email'));
  assert.ok(exposedKeys.includes('displayName'));
  assert.ok(exposedKeys.includes('employeeCode'));
  assert.ok(exposedKeys.includes('department'));
  assert.ok(exposedKeys.includes('jobTitle'));
  assert.ok(exposedKeys.includes('status'));
  assert.ok(exposedKeys.includes('roleId'));
  assert.ok(exposedKeys.includes('invitedAt'));

  // MUST NEVER EXPOSE SECRETS OR TOKENS
  assert.equal(exposedKeys.includes('passwordHash'), false, 'passwordHash must never be exposed');
  assert.equal(exposedKeys.includes('twoFactorSecret'), false, 'twoFactorSecret must never be exposed');
  assert.equal(exposedKeys.includes('twoFactorRecoveryCodes'), false, 'recovery codes must never be exposed');
  assert.equal(exposedKeys.includes('inviteTokenHash'), false, 'inviteTokenHash must never be exposed');
});
