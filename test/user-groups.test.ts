import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requirePlatformPermission } from '../src/middleware/platform';
import { requirePermission } from '../src/middleware/rbac';
import * as groupsDto from '../src/modules/groups/groups.dto';
import { groupsModuleDefinition } from '../src/modules/groups/groups.permissions';
import { slugify } from '../src/modules/groups/groups.service';
import { PLATFORM_PERMISSIONS } from '../src/modules/platform/platform.permissions';
import { SYSTEM_MODULE_DEFINITIONS } from '../src/modules/rbac/modules.registry';

test('groupsModuleDefinition is registered in system domain module registry', () => {
  const groupModule = SYSTEM_MODULE_DEFINITIONS.find((m) => m.key === 'groups');
  assert.ok(groupModule, 'groups module must be present in SYSTEM_MODULE_DEFINITIONS');
  assert.equal(groupModule.name, 'User Groups');

  const permKeys = groupModule.permissions.map((p) => p.key);
  assert.ok(permKeys.includes('groups:read'));
  assert.ok(permKeys.includes('groups:create'));
  assert.ok(permKeys.includes('groups:update'));
  assert.ok(permKeys.includes('groups:delete'));
  assert.ok(permKeys.includes('groups:manage-members'));
});

test('Platform permission catalogue contains canonical resource::action groups permissions', () => {
  assert.equal(PLATFORM_PERMISSIONS.GROUPS_READ, 'platform_groups::read');
  assert.equal(PLATFORM_PERMISSIONS.GROUPS_CREATE, 'platform_groups::create');
  assert.equal(PLATFORM_PERMISSIONS.GROUPS_UPDATE, 'platform_groups::update');
  assert.equal(PLATFORM_PERMISSIONS.GROUPS_DELETE, 'platform_groups::delete');
  assert.equal(PLATFORM_PERMISSIONS.GROUPS_MANAGE_MEMBERS, 'platform_groups::manage_members');
});

test('slugify helper formats names into clean URL-safe slugs', () => {
  assert.equal(slugify('Teaching Staff'), 'teaching-staff');
  assert.equal(slugify('Department - Computer Science & AI!'), 'department-computer-science-ai');
  assert.equal(slugify('  Parents  -- Grade 8  '), 'parents-grade-8');
});

test('createGroupDto validates name and optional slug correctly', () => {
  // Valid payload
  const valid = groupsDto.createGroupDto.parse({
    name: 'Engineering Team',
    slug: 'eng-team',
    description: 'Core product engineers',
  });
  assert.equal(valid.name, 'Engineering Team');
  assert.equal(valid.slug, 'eng-team');

  // Name trimmed
  const trimmed = groupsDto.createGroupDto.parse({
    name: '  Sales Operations  ',
  });
  assert.equal(trimmed.name, 'Sales Operations');

  // Empty name rejected
  assert.throws(() => {
    groupsDto.createGroupDto.parse({ name: '   ' });
  });

  // Invalid slug characters rejected
  assert.throws(() => {
    groupsDto.createGroupDto.parse({ name: 'Valid', slug: 'invalid_slug_with_underscores' });
  });

  assert.throws(() => {
    groupsDto.createGroupDto.parse({ name: 'Valid', slug: '-leading-hyphen' });
  });
});

test('addTenantGroupMembersDto deduplicates user IDs and validates UUID format', () => {
  const uuid1 = 'a0000000-0000-0000-0000-000000000001';
  const uuid2 = 'a0000000-0000-0000-0000-000000000002';

  const parsed = groupsDto.addTenantGroupMembersDto.parse({
    userIds: [uuid1, uuid2, uuid1, uuid2],
  });

  assert.equal(parsed.userIds.length, 2);
  assert.deepEqual(parsed.userIds, [uuid1, uuid2]);

  // Non-uuid rejected
  assert.throws(() => {
    groupsDto.addTenantGroupMembersDto.parse({
      userIds: ['not-a-uuid'],
    });
  });

  // Empty list rejected
  assert.throws(() => {
    groupsDto.addTenantGroupMembersDto.parse({
      userIds: [],
    });
  });
});

test('updateGroupDto rejects empty payload with no fields', () => {
  assert.throws(() => {
    groupsDto.updateGroupDto.parse({});
  });

  const valid = groupsDto.updateGroupDto.parse({
    name: 'Renamed Group',
  });
  assert.equal(valid.name, 'Renamed Group');
});

test('requirePermission enforces tenant group permission authorization', () => {
  const middleware = requirePermission('groups:create');

  // 1. Authorized with explicit permission
  let called = false;
  middleware({ permissions: ['groups:read', 'groups:create'] } as any, {} as any, (err?: any) => {
    assert.ifError(err);
    called = true;
  });
  assert.ok(called);

  // 2. Authorized with wildcard (*)
  let wildcardCalled = false;
  middleware({ permissions: ['*'] } as any, {} as any, (err?: any) => {
    assert.ifError(err);
    wildcardCalled = true;
  });
  assert.ok(wildcardCalled);

  // 3. Forbidden when lacking permission
  let errorCaught: any = null;
  middleware({ permissions: ['groups:read'] } as any, {} as any, (err?: any) => {
    errorCaught = err;
  });
  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
});

test('requirePlatformPermission enforces platform group authorization', () => {
  const middleware = requirePlatformPermission('platform_groups::create');

  // 1. Super Admin bypass
  let superAdminCalled = false;
  middleware(
    { staff: { roleKey: 'SUPER_ADMIN', permissions: [] } } as any,
    {} as any,
    (err?: any) => {
      assert.ifError(err);
      superAdminCalled = true;
    },
  );
  assert.ok(superAdminCalled);

  // 2. Operator with explicit permission
  let staffCalled = false;
  middleware(
    { staff: { roleKey: 'STAFF', permissions: ['platform_groups::create'] } } as any,
    {} as any,
    (err?: any) => {
      assert.ifError(err);
      staffCalled = true;
    },
  );
  assert.ok(staffCalled);

  // 3. Operator lacking permission gets 403
  let errorCaught: any = null;
  middleware(
    { staff: { roleKey: 'STAFF', permissions: ['platform_groups::read'] } } as any,
    {} as any,
    (err?: any) => {
      errorCaught = err;
    },
  );
  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 403);
});
