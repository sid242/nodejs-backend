import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db.js';
import { closeRedisClients } from '../src/config/redis.js';
import { AppError } from '../src/lib/errors.js';
import { requirePermission, requireTenantRole } from '../src/middleware/rbac.js';
import { hashToken } from '../src/modules/auth/verification.repository.js';
import { SYSTEM_MODULE_DEFINITIONS } from '../src/modules/rbac/modules.registry.js';
import * as rbacDto from '../src/modules/rbac/rbac.dto.js';
import * as rbacRepo from '../src/modules/rbac/rbac.repository.js';
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES } from '../src/modules/rbac/rbac.service.js';
import * as rbacService from '../src/modules/rbac/rbac.service.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Verification token SHA-256 hashing produces deterministic 64-char hex hash', () => {
  const token = '550e8400-e29b-41d4-a716-446655440000';
  const hashed1 = hashToken(token);
  const hashed2 = hashToken(token);

  assert.equal(hashed1, hashed2);
  assert.equal(hashed1.length, 64);
  assert.notEqual(token, hashed1);
});

test('Decentralized module definitions are loaded into system registry', () => {
  const moduleKeys = SYSTEM_MODULE_DEFINITIONS.map((m) => m.key);
  assert.ok(moduleKeys.includes('files'));
  assert.ok(moduleKeys.includes('tenants'));
  assert.ok(moduleKeys.includes('members'));
  assert.ok(moduleKeys.includes('rbac'));
  assert.ok(moduleKeys.includes('audit'));
});

test('Dynamic RBAC system permissions catalog contains required domain resources', () => {
  const keys = SYSTEM_PERMISSIONS.map((p) => p.key);

  assert.ok(keys.includes('tenants:read'));
  assert.ok(keys.includes('tenants:update'));
  assert.ok(keys.includes('tenants:delete'));
  assert.ok(keys.includes('members:read'));
  assert.ok(keys.includes('members:invite'));
  assert.ok(keys.includes('roles:read'));
  assert.ok(keys.includes('roles:create'));
  assert.ok(keys.includes('files:read'));
  assert.ok(keys.includes('files:write'));
  assert.ok(keys.includes('files:delete'));
  assert.ok(keys.includes('audit:read'));
});

test('requirePermission middleware allows authorized users with explicit permission', () => {
  const req: any = {
    permissions: ['files:read', 'files:write'],
  };
  let called = false;
  const next = (err?: any) => {
    assert.ifError(err);
    called = true;
  };

  const handler = requirePermission('files:read');
  handler(req, {} as any, next);

  assert.equal(called, true);
});

test('requirePermission middleware allows wildcard (*) admin / owner access', () => {
  const req: any = {
    permissions: ['*'],
  };
  let called = false;
  const next = (err?: any) => {
    assert.ifError(err);
    called = true;
  };

  const handler = requirePermission('tenants:delete');
  handler(req, {} as any, next);

  assert.equal(called, true);
});

test('requirePermission middleware blocks unauthorized user with 403 Forbidden', () => {
  const req: any = {
    permissions: ['files:read'],
  };
  let caughtError: any = null;
  const next = (err?: any) => {
    caughtError = err;
  };

  const handler = requirePermission('files:delete');
  handler(req, {} as any, next);

  assert.ok(caughtError instanceof AppError);
  assert.equal(caughtError.status, 403);
  assert.match(caughtError.message, /Missing required permission: files:delete/);
});

test('requireTenantRole blocks user without matching tenant role', () => {
  const req: any = {
    membership: { roles: ['VIEWER'] },
    user: { id: 'usr-1' },
  };
  let caughtError: any = null;
  const next = (err?: any) => {
    caughtError = err;
  };

  const handler = requireTenantRole(SYSTEM_ROLES.OWNER);
  handler(req, {} as any, next);

  assert.ok(caughtError instanceof AppError);
  assert.equal(caughtError.status, 403);
  assert.match(caughtError.message, /Requires tenant role: OWNER/);
});

test('requireTenantRole allows user with matching tenant role', () => {
  const req: any = {
    membership: { roles: ['OWNER'] },
    user: { id: 'usr-1' },
  };
  let called = false;
  const next = (err?: any) => {
    assert.ifError(err);
    called = true;
  };

  const handler = requireTenantRole(SYSTEM_ROLES.OWNER);
  handler(req, {} as any, next);

  assert.equal(called, true);
});

test('RBAC module and permission DTO validation contracts', () => {
  // 1. Valid module creation parses with default sortOrder
  const validModule = rbacDto.createModuleDto.parse({
    key: 'billing',
    name: 'Billing & Invoices',
  });
  assert.equal(validModule.sortOrder, 0);

  // 2. Invalid module key (contains uppercase / invalid characters) rejected
  assert.throws(() => {
    rbacDto.createModuleDto.parse({
      key: 'Billing_Invalid!',
      name: 'Billing',
    });
  });

  // 3. Valid permission key format 'resource:action'
  const validPerm = rbacDto.createPermissionDto.parse({
    key: 'billing:invoice_download',
    name: 'Download Invoices',
  });
  assert.equal(validPerm.action, 'manage');

  // 4. Invalid permission key format (missing colon separator) rejected
  assert.throws(() => {
    rbacDto.createPermissionDto.parse({
      key: 'billing_download_without_colon',
      name: 'Download',
    });
  });

  // 5. Update role DTO allows partial updates
  const validRoleUpdate = rbacDto.updateRoleDto.parse({
    name: 'Senior Billing Specialist',
    permissions: ['billing:read', 'billing:write'],
  });
  assert.equal(validRoleUpdate.name, 'Senior Billing Specialist');
  assert.equal(validRoleUpdate.permissions?.length, 2);
});

test('Dynamic module and permissions lifecycle (Create, Read, Update, Delete, Protections)', async (t) => {
  // Verify PostgreSQL availability before executing live DB operations
  try {
    await rbacRepo.findAllPermissions();
  } catch {
    t.skip('Skipping DB integration test: PostgreSQL is offline');
    return;
  }

  const testModuleKey = `test_mod_${Date.now()}`;

  // 1. Create custom module with inline permissions
  const createdMod = await rbacService.createModule({
    key: testModuleKey,
    name: 'Test Automation Module',
    description: 'Custom module for integration testing',
    icon: 'cpu',
    sortOrder: 99,
    permissions: [
      { key: `${testModuleKey}:view`, name: 'View Automated Runs', action: 'read' },
      { key: `${testModuleKey}:run`, name: 'Trigger Automated Run', action: 'write' },
    ],
  });

  assert.ok(createdMod.id);
  assert.equal(createdMod.key, testModuleKey);
  assert.equal(createdMod.isSystem, false);
  assert.equal(createdMod.permissions.length, 2);

  // 2. Reject duplicate module key
  await assert.rejects(
    async () => {
      await rbacService.createModule({
        key: testModuleKey,
        name: 'Duplicate Module',
      });
    },
    (err: any) => err instanceof AppError && err.status === 409,
  );

  // 3. Retrieve module by ID
  const retrieved = await rbacService.getModuleById(createdMod.id);
  assert.equal(retrieved.name, 'Test Automation Module');
  assert.equal(retrieved.permissions.length, 2);

  // 4. Create an additional standalone permission under this module
  const newPerm = await rbacService.createPermission({
    moduleId: createdMod.id,
    key: `${testModuleKey}:cancel`,
    name: 'Cancel Automated Run',
    action: 'delete',
  });
  assert.ok(newPerm.id);
  assert.equal(newPerm.key, `${testModuleKey}:cancel`);

  // 5. Reject duplicate permission key
  await assert.rejects(
    async () => {
      await rbacService.createPermission({
        moduleId: createdMod.id,
        key: `${testModuleKey}:cancel`,
        name: 'Duplicate Permission',
      });
    },
    (err: any) => err instanceof AppError && err.status === 409,
  );

  // 6. Update permission
  const updatedPerm = await rbacService.updatePermission(newPerm.id, {
    name: 'Abort Automated Run Immediately',
  });
  assert.equal(updatedPerm.name, 'Abort Automated Run Immediately');

  // 7. Protected built-in permissions: Cannot delete built-in system permissions
  await assert.rejects(
    async () => {
      const filesReadPerm = await rbacRepo.findPermissionByKey('files:read');
      if (filesReadPerm) {
        await rbacService.deletePermission(filesReadPerm.id);
      }
    },
    (err: any) => err instanceof AppError && err.status === 403,
  );

  // 8. Delete custom permission
  await rbacService.deletePermission(newPerm.id);
  const deletedPermCheck = await rbacRepo.findPermissionById(newPerm.id);
  assert.equal(deletedPermCheck, null);

  // 9. Update module metadata
  const updatedMod = await rbacService.updateModule(createdMod.id, {
    name: 'Updated Test Automation Module',
    sortOrder: 100,
  });
  assert.equal(updatedMod.name, 'Updated Test Automation Module');
  assert.equal(updatedMod.sortOrder, 100);

  // 10. Protected built-in modules: Cannot delete built-in system modules
  await assert.rejects(
    async () => {
      const filesModule = await rbacRepo.findModuleByKey('files');
      if (filesModule) {
        await rbacService.deleteModule(filesModule.id);
      }
    },
    (err: any) => err instanceof AppError && err.status === 403,
  );

  // 11. Delete custom module (cascades to permissions)
  await rbacService.deleteModule(createdMod.id);
  const deletedModCheck = await rbacRepo.findModuleById(createdMod.id);
  assert.equal(deletedModCheck, null);
  const orphanPerms = await rbacRepo.findPermissionsByModuleId(createdMod.id);
  assert.equal(orphanPerms.length, 0);
});
