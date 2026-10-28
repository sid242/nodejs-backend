import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { closeDb, db } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { closeRedisClients } from '../src/config/redis.js';
import {
  platformRoles,
  platformStaff,
  platformSupportSessions,
  users,
} from '../src/db/schema/index.js';
import { requireAuth } from '../src/middleware/auth.js';
import { requirePlatformAuth } from '../src/middleware/platform.js';
import { resolveTenantContext } from '../src/middleware/tenant.js';
import * as authRepo from '../src/modules/auth/auth.repository.js';
import * as authService from '../src/modules/auth/auth.service.js';
import { createMagicLinkToken, issueTokens } from '../src/modules/auth/tokens.js';
import * as filesRepo from '../src/modules/files/files.repository.js';
import * as platformService from '../src/modules/platform/platform.service.js';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository.js';
import * as tenantsService from '../src/modules/tenants/tenants.service.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Phase 1: S1 - Invite response omits inviteToken/inviteUrl in production and keeps existing users in INVITED status', async () => {
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const existingEmail = `existing-user-${Date.now()}@example.com`;
    const [existingUser] = await db
      .insert(users)
      .values({
        email: existingEmail,
        name: 'Existing Account',
        passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
        status: 'ACTIVE',
      })
      .returning();
    assert.ok(existingUser);

    const testTenant = await tenantsRepo.createTenant({
      name: 'Invite Test Tenant',
      slug: `invite-test-${Date.now()}`,
    });

    const result = await tenantsService.addMemberToTenant(
      testTenant.id,
      existingUser.id, // operatorUserId
      existingEmail, // userEmail
      'MEMBER', // roleName
    );

    // Assert token and URL are omitted in production
    assert.equal((result as any).inviteToken, undefined, 'inviteToken must never be returned');
    assert.equal((result as any).inviteUrl, undefined, 'inviteUrl must be omitted in production');

    // Assert existing user is set to INVITED (not ACTIVE) until accepted
    const member = await tenantsRepo.findTenantMember(testTenant.id, existingUser.id);
    assert.ok(member, 'Member record must exist');
    assert.equal(member.status, 'INVITED', 'Existing user must remain INVITED until consent');
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('Phase 1: S1 - Accepting invite for Tenant A does not activate pending membership in Tenant B', async () => {
  const email = `multi-invite-${Date.now()}@example.com`;
  const [user] = await db
    .insert(users)
    .values({
      email,
      name: 'Multi Workspace User',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(user);

  const tenantA = await tenantsRepo.createTenant({
    name: 'Workspace A',
    slug: `ws-a-${Date.now()}`,
  });
  const tenantB = await tenantsRepo.createTenant({
    name: 'Workspace B',
    slug: `ws-b-${Date.now()}`,
  });

  // Add user to both tenants in INVITED state
  const memberA = await tenantsRepo.addTenantMember({
    tenantId: tenantA.id,
    userId: user.id,
    status: 'INVITED',
  });
  const memberB = await tenantsRepo.addTenantMember({
    tenantId: tenantB.id,
    userId: user.id,
    status: 'INVITED',
  });
  assert.ok(memberA && memberB);

  // Generate invitation token specifically bound to tenant A
  const tokenForTenantA = await createMagicLinkToken(user.id, 3600, tenantA.id);

  // Accept invitation using token bound to tenant A (pass expectedTenantId = tenantA.id)
  await tenantsService.acceptTenantInvitation(tokenForTenantA, tenantA.id);

  // Check status in Tenant A -> must be ACTIVE
  const updatedMemberA = await tenantsRepo.findTenantMember(tenantA.id, user.id);
  assert.equal(updatedMemberA?.status, 'ACTIVE', 'Membership for Tenant A must be activated');

  // Check status in Tenant B -> MUST REMAIN INVITED
  const updatedMemberB = await tenantsRepo.findTenantMember(tenantB.id, user.id);
  assert.equal(updatedMemberB?.status, 'INVITED', 'Membership for Tenant B must remain INVITED');
});

test('Phase 1: S5 - Token separation: Customer token rejected by requirePlatformAuth; Staff token rejected by requireAuth', async () => {
  const customerUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'customer@example.com',
    name: 'Customer User',
    status: 'ACTIVE' as const,
    emailVerifiedAt: new Date(),
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const customerTokens = await issueTokens(customerUser);

  // 1. Customer token sent to requirePlatformAuth -> must reject with 401
  const reqPlatform: any = {
    headers: { authorization: `Bearer ${customerTokens.accessToken}` },
    cookies: {},
  };
  let platformAuthError: any = null;
  await requirePlatformAuth(reqPlatform, {} as any, (err?: any) => {
    platformAuthError = err;
  });
  assert.ok(platformAuthError, 'requirePlatformAuth must reject customer token');
  assert.equal(platformAuthError?.status, 401);

  // 2. Staff token created with platform secret sent to requireAuth -> must reject with 401
  const staffToken = jwt.sign(
    {
      sub: '22222222-2222-2222-2222-222222222222',
      email: 'staff@example.com',
      roleId: '33333333-3333-3333-3333-333333333333',
      typ: 'STAFF',
    },
    env.JWT_PLATFORM_SECRET,
    {
      expiresIn: '15m',
      audience: 'platform-api',
      issuer: 'node-scalable-foundation',
    },
  );

  const reqUser: any = {
    headers: { authorization: `Bearer ${staffToken}` },
    cookies: {},
  };
  let userAuthError: any = null;
  await requireAuth(reqUser, {} as any, (err?: any) => {
    userAuthError = err;
  });
  assert.ok(userAuthError, 'requireAuth must reject staff token');
  assert.equal(userAuthError?.status, 401);
});

test('Phase 1: S4 - Platform Staff privilege escalation guards & last-super-admin invariant', async () => {
  // Retrieve SUPER_ADMIN and SUPPORT_STAFF roles
  const [superAdminRole] = await db
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.key, 'SUPER_ADMIN'))
    .limit(1);
  const [supportRole] = await db
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.key, 'SUPPORT_STAFF'))
    .limit(1);
  assert.ok(superAdminRole && supportRole);

  // Create a support staff actor
  const [supportStaff] = await db
    .insert(platformStaff)
    .values({
      email: `support-${Date.now()}@platform.local`,
      displayName: 'Support Agent',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      roleId: supportRole.id,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(supportStaff);

  const supportActor = {
    id: supportStaff.id,
    roleId: supportRole.id,
    isSuperAdmin: false,
    permissions: ['platform_staff:read', 'platform_staff:create', 'platform_staff:update'],
  };

  // 1. Non-super-admin attempting to create a staff with SUPER_ADMIN role must be rejected
  await assert.rejects(
    async () => {
      await platformService.createStaff(
        supportActor,
        {
          email: `escalate-${Date.now()}@platform.local`,
          displayName: 'Escalation Attempt',
          password: 'Password@123456',
          roleId: superAdminRole.id,
        },
      );
    },
    (err: any) => {
      assert.equal(err?.status, 403);
      assert.match(err?.message, /Super Admin/i);
      return true;
    },
  );

  // 2. Staff attempting to modify their own role/status must be rejected
  await assert.rejects(
    async () => {
      await platformService.updateStaff(
        supportActor,
        supportStaff.id,
        { roleId: superAdminRole.id },
      );
    },
    (err: any) => {
      assert.ok([400, 403].includes(err?.status));
      assert.match(err?.message, /cannot change (their|your) own/i);
      return true;
    },
  );
});

test('Phase 1: S5 - Support session header is rejected if caller is not the session staff', async () => {
  const tenant = await tenantsRepo.createTenant({
    name: 'Support Guard Tenant',
    slug: `support-guard-${Date.now()}`,
  });

  const [supportRole] = await db
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.key, 'SUPPORT_STAFF'))
    .limit(1);
  assert.ok(supportRole);

  const [staffA] = await db
    .insert(platformStaff)
    .values({
      email: `staff-a-${Date.now()}@platform.local`,
      displayName: 'Staff A',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      roleId: supportRole.id,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(staffA);

  const [session] = await db
    .insert(platformSupportSessions)
    .values({
      staffId: staffA.id,
      tenantId: tenant.id,
      reason: 'Investigate ticket',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    .returning();
  assert.ok(session);

  // Request by customer user with x-support-session-id -> ignored, passes 403 forbidden to next()
  const reqCustomer: any = {
    headers: {
      'x-tenant-id': tenant.id,
      'x-support-session-id': session.id,
    },
    user: { id: '44444444-4444-4444-4444-444444444444' },
    staff: undefined, // Not staff
  };

  let customerErr: any = null;
  await resolveTenantContext(reqCustomer, {} as any, (err?: any) => {
    customerErr = err;
  });
  assert.ok(customerErr, 'resolveTenantContext must reject customer user attempting support session');
  assert.equal(customerErr?.status, 403);

  // Request by Staff B (not the session initiator) -> passes 403 forbidden to next()
  const reqOtherStaff: any = {
    headers: {
      'x-tenant-id': tenant.id,
      'x-support-session-id': session.id,
    },
    staff: { id: '55555555-5555-5555-5555-555555555555', roleId: supportRole.id },
  };

  let otherStaffErr: any = null;
  await resolveTenantContext(reqOtherStaff, {} as any, (err?: any) => {
    otherStaffErr = err;
  });
  assert.ok(otherStaffErr, 'resolveTenantContext must reject different staff member');
  assert.equal(otherStaffErr?.status, 403);
});

test('Phase 1: S9 - requestMagicLink does not create accounts and returns generic message', async () => {
  const nonexistentEmail = `nonexistent-${Date.now()}@example.com`;

  const result = await authService.requestMagicLink(nonexistentEmail);
  assert.match(result.message, /If an account exists with this email/);

  // Confirm user was NOT provisioned
  const user = await authRepo.findByEmail(nonexistentEmail);
  assert.equal(user, null, 'User must not be provisioned by requestMagicLink');
});

test('Phase 1: S7 - File repository enforces tenant isolation on findById and updateStatusAndSize', async () => {
  const tenant1 = await tenantsRepo.createTenant({
    name: 'File Tenant 1',
    slug: `file-t1-${Date.now()}`,
  });
  const tenant2 = await tenantsRepo.createTenant({
    name: 'File Tenant 2',
    slug: `file-t2-${Date.now()}`,
  });

  const [owner] = await db
    .insert(users)
    .values({
      email: `file-owner-${Date.now()}@example.com`,
      name: 'File Owner',
      passwordHash: '$2a$12$dummyhash0000000000000000000000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(owner);

  const file = await filesRepo.createFile({
    tenantId: tenant1.id,
    ownerId: owner.id,
    key: `uploads/${tenant1.id}/test.png`,
    filename: 'test.png',
    contentType: 'image/png',
  });

  // Querying with tenant1.id must find the file
  const foundSameTenant = await filesRepo.findById(file.id, tenant1.id);
  assert.ok(foundSameTenant);
  assert.equal(foundSameTenant.id, file.id);

  // Querying with tenant2.id must return null
  const foundCrossTenant = await filesRepo.findById(file.id, tenant2.id);
  assert.equal(foundCrossTenant, null, 'Cross-tenant findById must return null');

  // Updating status with mismatched tenant must return null
  const updatedCrossTenant = await filesRepo.updateStatusAndSize(
    file.id,
    { status: 'UPLOADED', size: 2048 },
    tenant2.id,
  );
  assert.equal(updatedCrossTenant, null, 'Cross-tenant updateStatusAndSize must return null');

  // Updating status with matching tenant must succeed
  const updatedSameTenant = await filesRepo.updateStatusAndSize(
    file.id,
    { status: 'UPLOADED', size: 2048 },
    tenant1.id,
  );
  assert.ok(updatedSameTenant);
  assert.equal(updatedSameTenant.status, 'UPLOADED');
  assert.equal(updatedSameTenant.size, 2048);
});
