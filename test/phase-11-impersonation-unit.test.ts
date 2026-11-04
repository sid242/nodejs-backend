import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import {
  auditLogs,
  platformPermissions,
  platformRolePermissions,
  platformRoles,
  platformStaff,
  platformSupportSessions,
  roles,
  tenantMemberRoles,
  tenantMembers,
  tenants,
  users,
} from '../src/db/schema/index';
import { AppError } from '../src/lib/errors';
import {
  auditSupportActions,
  requireSupportOrUser,
} from '../src/middleware/support';
import {
  issueSupportToken,
} from '../src/modules/auth/tokens';
import { PLATFORM_PERMISSIONS } from '../src/modules/platform/platform.permissions';
import * as platformRepo from '../src/modules/platform/platform.repository';
import * as platformService from '../src/modules/platform/platform.service';
import { SYSTEM_ROLES } from '../src/modules/rbac/rbac.service';
import * as tenantsRepo from '../src/modules/tenants/tenants.repository';

let testTenantId: string;
let regularStaffId: string;
let superAdminStaffId: string;
let targetUserId: string;
let targetMemberId: string;
let ownerUserId: string;
let ownerMemberId: string;
let inactiveUserId: string;
let inactiveMemberId: string;

let superAdminRoleId: string;
let supportAgentRoleId: string;

after(async () => {
  // Cleanup test entities
  if (testTenantId) {
    await db.delete(platformSupportSessions).where(eq(platformSupportSessions.tenantId, testTenantId));
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, testTenantId));
    const memberIds = [targetMemberId, ownerMemberId, inactiveMemberId].filter(Boolean);
    if (memberIds.length > 0) {
      await db.delete(tenantMemberRoles).where(inArray(tenantMemberRoles.memberId, memberIds));
    }
    await db.delete(tenantMembers).where(eq(tenantMembers.tenantId, testTenantId));
    await db.delete(roles).where(eq(roles.tenantId, testTenantId));
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  if (regularStaffId) {
    await db.delete(platformStaff).where(eq(platformStaff.id, regularStaffId));
  }
  if (superAdminStaffId) {
    await db.delete(platformStaff).where(eq(platformStaff.id, superAdminStaffId));
  }
  if (supportAgentRoleId) {
    await db.delete(platformRolePermissions).where(eq(platformRolePermissions.roleId, supportAgentRoleId));
    await db.delete(platformRoles).where(eq(platformRoles.id, supportAgentRoleId));
  }
  const userIds = [targetUserId, ownerUserId, inactiveUserId].filter(Boolean);
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }

  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 300).unref();
});

before(async () => {
  // 1. Ensure Super Admin role exists
  let [superAdminRole] = await db
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.key, 'SUPER_ADMIN'))
    .limit(1);

  if (!superAdminRole) {
    [superAdminRole] = await db
      .insert(platformRoles)
      .values({
        key: 'SUPER_ADMIN',
        name: 'Super Administrator',
        description: 'Complete unrestricted platform administrative control',
        isActive: true,
      })
      .returning();
  }
  assert.ok(superAdminRole);
  superAdminRoleId = superAdminRole.id;

  // 2. Create Support Agent role with only SUPPORT_START and SUPPORT_END (lacking SUPPORT_WRITE and SUPPORT_IMPERSONATE)
  const agentRoleKey = `SUPPORT_LIMITED_${Date.now()}`;
  const [agentRole] = await db
    .insert(platformRoles)
    .values({
      key: agentRoleKey,
      name: 'Limited Support Agent',
      description: 'Support agent with restricted permissions',
      isActive: true,
    })
    .returning();
  assert.ok(agentRole);
  supportAgentRoleId = agentRole.id;

  // Ensure canonical permissions exist in DB
  let [permStart] = await db
    .select()
    .from(platformPermissions)
    .where(eq(platformPermissions.key, PLATFORM_PERMISSIONS.SUPPORT_START))
    .limit(1);
  if (!permStart) {
    [permStart] = await db
      .insert(platformPermissions)
      .values({
        key: PLATFORM_PERMISSIONS.SUPPORT_START,
        name: 'Start Support Session',
        action: 'start',
        resource: 'tenant_support',
      })
      .returning();
  }
  assert.ok(permStart);

  await db
    .insert(platformRolePermissions)
    .values({ roleId: supportAgentRoleId, permissionId: permStart.id })
    .onConflictDoNothing();

  // 3. Create regular staff (limited support)
  const [regStaff] = await db
    .insert(platformStaff)
    .values({
      email: `limited-staff-${Date.now()}@platform.saas`,
      displayName: 'Limited Support Staff',
      passwordHash: '$2a$12$dummyhashforstaff0000000000000000000000000000000000',
      roleId: supportAgentRoleId,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(regStaff);
  regularStaffId = regStaff.id;

  // 4. Create super admin staff
  const [saStaff] = await db
    .insert(platformStaff)
    .values({
      email: `superadmin-staff-${Date.now()}@platform.saas`,
      displayName: 'Super Admin Staff',
      passwordHash: '$2a$12$dummyhashforstaff0000000000000000000000000000000000',
      roleId: superAdminRoleId,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(saStaff);
  superAdminStaffId = saStaff.id;

  // 5. Create test customer tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Phase 10 Test Organization',
      slug: `phase10-impersonation-${Date.now()}`,
      status: 'ACTIVE',
      plan: 'ENTERPRISE',
      allowSupportAccess: true,
    })
    .returning();
  assert.ok(tenant);
  testTenantId = tenant.id;

  // 6. Ensure default OWNER and MEMBER roles exist in tenant
  const [ownerRole] = await db
    .insert(roles)
    .values({
      tenantId: testTenantId,
      name: SYSTEM_ROLES.OWNER,
      code: SYSTEM_ROLES.OWNER,
      description: 'Owner role',
    })
    .returning();
  assert.ok(ownerRole);

  const [memberRole] = await db
    .insert(roles)
    .values({
      tenantId: testTenantId,
      name: SYSTEM_ROLES.MEMBER,
      code: SYSTEM_ROLES.MEMBER,
      description: 'Member role',
    })
    .returning();
  assert.ok(memberRole);

  // 7. Create owner user & membership
  const [owner] = await db
    .insert(users)
    .values({
      email: `owner-${Date.now()}@example.com`,
      name: 'Workspace Owner',
      passwordHash: '$2a$12$dummyuserpasswordhash00000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(owner);
  ownerUserId = owner.id;

  const [ownerMem] = await db
    .insert(tenantMembers)
    .values({
      tenantId: testTenantId,
      userId: ownerUserId,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(ownerMem);
  ownerMemberId = ownerMem.id;

  await db
    .insert(tenantMemberRoles)
    .values({
      memberId: ownerMemberId,
      roleId: ownerRole.id,
    });

  // 8. Create active member user & membership
  const [target] = await db
    .insert(users)
    .values({
      email: `member-${Date.now()}@example.com`,
      name: 'Regular Workspace Member',
      passwordHash: '$2a$12$dummyuserpasswordhash00000000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(target);
  targetUserId = target.id;

  const [targetMem] = await db
    .insert(tenantMembers)
    .values({
      tenantId: testTenantId,
      userId: targetUserId,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(targetMem);
  targetMemberId = targetMem.id;

  await db
    .insert(tenantMemberRoles)
    .values({
      memberId: targetMemberId,
      roleId: memberRole.id,
    });

  // 9. Create suspended/inactive member user & membership
  const [inactive] = await db
    .insert(users)
    .values({
      email: `inactive-${Date.now()}@example.com`,
      name: 'Suspended Member',
      passwordHash: '$2a$12$dummyuserpasswordhash00000000000000000000000000000',
      status: 'SUSPENDED',
    })
    .returning();
  assert.ok(inactive);
  inactiveUserId = inactive.id;

  const [inactiveMem] = await db
    .insert(tenantMembers)
    .values({
      tenantId: testTenantId,
      userId: inactiveUserId,
      status: 'SUSPENDED',
    })
    .returning();
  assert.ok(inactiveMem);
  inactiveMemberId = inactiveMem.id;

  await db
    .insert(tenantMemberRoles)
    .values({
      memberId: inactiveMemberId,
      roleId: memberRole.id,
    });
});

// Test 1: Unauthorized staff cannot start privileged support session
test('Test 1: Staff without tenant_support::write cannot start FULL scope support session', async () => {
  await assert.rejects(
    async () => {
      await platformService.startSupportSession(regularStaffId, testTenantId, {
        mode: 'TENANT_SCOPED',
        scope: 'FULL',
        reason: 'Attempting full access without permission',
        durationMinutes: 30,
        acknowledgement: true,
      });
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 403);
      assert.match(err.message, /Requires tenant_support::write permission/i);
      return true;
    },
  );
});

test('Test 1b: Staff without tenant_support::impersonate cannot start AS_MEMBER support session', async () => {
  await assert.rejects(
    async () => {
      await platformService.startSupportSession(regularStaffId, testTenantId, {
        mode: 'AS_MEMBER',
        scope: 'READ_ONLY',
        targetUserId,
        reason: 'Attempting impersonation without permission',
        durationMinutes: 30,
        acknowledgement: true,
      });
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 403);
      assert.match(err.message, /Requires tenant_support::impersonate permission/i);
      return true;
    },
  );
});

// Test 2: Inactive or non-member target is rejected with 400 Bad Request
test('Test 2: Non-member or inactive member target is rejected with 400 Bad Request', async () => {
  const nonExistentUserId = randomUUID();

  await assert.rejects(
    async () => {
      await platformService.startSupportSession(superAdminStaffId, testTenantId, {
        mode: 'AS_MEMBER',
        scope: 'READ_ONLY',
        targetUserId: nonExistentUserId,
        reason: 'Investigating missing user problem',
        durationMinutes: 30,
        acknowledgement: true,
      });
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 400);
      assert.match(err.message, /Target member not found or is not active/i);
      return true;
    },
  );

  // Inactive target member rejected
  await assert.rejects(
    async () => {
      await platformService.startSupportSession(superAdminStaffId, testTenantId, {
        mode: 'AS_MEMBER',
        scope: 'READ_ONLY',
        targetUserId: inactiveUserId,
        reason: 'Attempting to impersonate suspended member',
        durationMinutes: 30,
        acknowledgement: true,
      });
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 400);
      assert.match(err.message, /Target member not found or is not active/i);
      return true;
    },
  );
});

// Test 3: Non-SuperAdmin staff cannot target workspace Owner
test('Test 3: Non-SuperAdmin cannot target workspace Owner with AS_MEMBER impersonation', async () => {
  // Give limited staff the impersonate permission temporarily
  let [permImpersonate] = await db
    .select()
    .from(platformPermissions)
    .where(eq(platformPermissions.key, PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE))
    .limit(1);
  if (!permImpersonate) {
    [permImpersonate] = await db
      .insert(platformPermissions)
      .values({
        key: PLATFORM_PERMISSIONS.SUPPORT_IMPERSONATE,
        name: 'Impersonate Support Session',
        action: 'impersonate',
        resource: 'tenant_support',
      })
      .returning();
  }
  assert.ok(permImpersonate);

  await db
    .insert(platformRolePermissions)
    .values({ roleId: supportAgentRoleId, permissionId: permImpersonate.id })
    .onConflictDoNothing();

  await assert.rejects(
    async () => {
      await platformService.startSupportSession(regularStaffId, testTenantId, {
        mode: 'AS_MEMBER',
        scope: 'READ_ONLY',
        targetUserId: ownerUserId,
        reason: 'Attempting to impersonate workspace owner',
        durationMinutes: 30,
        acknowledgement: true,
      });
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 403);
      assert.match(err.message, /Only Super Admin may initiate a support session targeting a workspace Owner/i);
      return true;
    },
  );
});

// Test 4: Workspace allowSupportAccess toggle blocks support sessions when disabled
test('Test 4: Workspace allowSupportAccess toggle blocks support session initiation when false', async () => {
  // Turn off allowSupportAccess
  await tenantsRepo.updateTenant(testTenantId, { allowSupportAccess: false });

  try {
    await assert.rejects(
      async () => {
        await platformService.startSupportSession(superAdminStaffId, testTenantId, {
          mode: 'TENANT_SCOPED',
          scope: 'READ_ONLY',
          reason: 'Emergency check when support is disabled by tenant',
          durationMinutes: 30,
          acknowledgement: true,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.status, 403);
        assert.match(err.message, /This workspace has disabled support access/i);
        return true;
      },
    );
  } finally {
    // Re-enable allowSupportAccess
    await tenantsRepo.updateTenant(testTenantId, { allowSupportAccess: true });
  }
});

// Test 5: Nested impersonation attempt throws 403 Forbidden
test('Test 5: Nested impersonation attempt is strictly prohibited with 403 Forbidden', async () => {
  const nestedActor: any = {
    id: superAdminStaffId,
    roleKey: 'SUPER_ADMIN',
    permissions: ['*'],
    isSupportSession: true,
  };

  await assert.rejects(
    async () => {
      await platformService.startSupportSession(nestedActor, testTenantId, {
        mode: 'TENANT_SCOPED',
        scope: 'READ_ONLY',
        reason: 'Attempting nested support session',
        durationMinutes: 30,
        acknowledgement: true,
      });
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 403);
      assert.match(err.message, /Nested impersonation is strictly prohibited/i);
      return true;
    },
  );

  // Also verify enterSupportSession rejects nested flag
  await assert.rejects(
    async () => {
      await platformService.enterSupportSession(
        superAdminStaffId,
        randomUUID(),
        undefined,
        true, // isNested
      );
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 403);
      assert.match(err.message, /Nested impersonation is strictly prohibited/i);
      return true;
    },
  );
});

// Test 6: Expired support session is marked EXPIRED and cannot be entered
test('Test 6: Expired support session is automatically marked EXPIRED and rejected', async () => {
  // Start session directly with expiresAt in the past
  const expiredSession = await platformRepo.createSupportSession({
    staffId: superAdminStaffId,
    tenantId: testTenantId,
    mode: 'TENANT_SCOPED',
    scope: 'READ_ONLY',
    status: 'ACTIVE',
    reason: 'Investigate transient spike',
    expiresAt: new Date(Date.now() - 5000), // 5 seconds ago
  });

  await assert.rejects(
    async () => {
      await platformService.enterSupportSession(superAdminStaffId, expiredSession.id);
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 400);
      assert.match(err.message, /Support session has expired/i);
      return true;
    },
  );

  // Verify status in DB was updated to EXPIRED
  const refreshed = await platformRepo.findSupportSessionById(expiredSession.id);
  assert.equal(refreshed?.status, 'EXPIRED');

  // Verify requireSupportOrUser also marks EXPIRED and rejects with 401
  const { token } = issueSupportToken(
    {
      sess: expiredSession.id,
      staffId: superAdminStaffId,
      tenantId: testTenantId,
      mode: 'TENANT_SCOPED',
      scope: 'READ_ONLY',
    },
    30,
  );

  const req: any = {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    cookies: {},
  };
  let caughtError: any = null;
  await requireSupportOrUser(req, {} as any, (err?: any) => {
    caughtError = err;
  });
  assert.ok(caughtError instanceof AppError);
  assert.equal(caughtError.status, 403); // Status was updated to EXPIRED, so forbidden
});

// Test 7: Terminated session immediately denies subsequent requests
test('Test 7: Terminated session immediately denies subsequent requests', async () => {
  const activeSession = await platformService.startSupportSession(
    superAdminStaffId,
    testTenantId,
    {
      mode: 'TENANT_SCOPED',
      scope: 'READ_ONLY',
      reason: 'Standard maintenance inspection',
      ticketRef: 'TICKET-10492',
      durationMinutes: 30,
      acknowledgement: true,
    },
  );

  // Enter session to obtain token
  const enterResult = await platformService.enterSupportSession(
    superAdminStaffId,
    activeSession.sessionId,
  );
  assert.ok(enterResult.token);

  // Terminate session
  await platformService.endSupportSession(
    superAdminStaffId,
    activeSession.sessionId,
    'Investigation completed successfully',
  );

  // Verify enter fails now
  await assert.rejects(
    async () => {
      await platformService.enterSupportSession(
        superAdminStaffId,
        activeSession.sessionId,
      );
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.status, 403);
      assert.match(err.message, /Support session is currently terminated/i);
      return true;
    },
  );

  // Verify requireSupportOrUser rejects terminated session token fail-closed
  const req: any = {
    method: 'GET',
    headers: { authorization: `Bearer ${enterResult.token}` },
    cookies: {},
  };
  let caughtErr: any = null;
  await requireSupportOrUser(req, {} as any, (err?: any) => {
    caughtErr = err;
  });
  assert.ok(caughtErr instanceof AppError);
  assert.equal(caughtErr.status, 403);
  assert.match(caughtErr.message, /Support session is currently terminated/i);
});

// Test 8: Audit dual-actor attribution preserves staff actor, target user, and source: IMPERSONATION
test('Test 8: Audit dual-actor attribution preserves actorStaffId, targetUserId, and source: IMPERSONATION', async () => {
  // Start an AS_MEMBER session targeting targetUserId
  const session = await platformService.startSupportSession(
    superAdminStaffId,
    testTenantId,
    {
      mode: 'AS_MEMBER',
      scope: 'FULL',
      targetUserId,
      reason: 'Diagnose user permissions issue',
      ticketRef: 'TICKET-7731',
      durationMinutes: 45,
      acknowledgement: true,
    },
  );

  // Simulate a mutating HTTP request going through auditSupportActions middleware
  const finishCallbacks: Array<() => Promise<void> | void> = [];
  const mockRes: any = {
    statusCode: 200,
    on: (event: string, callback: () => Promise<void> | void) => {
      if (event === 'finish') finishCallbacks.push(callback);
    },
  };

  const mockReq: any = {
    isSupportSession: true,
    method: 'POST',
    baseUrl: '/api/v1/files',
    path: '/upload-confirm',
    supportSession: {
      id: session.sessionId,
      staffId: superAdminStaffId,
      tenantId: testTenantId,
      mode: 'AS_MEMBER',
      scope: 'FULL',
      targetUserId,
      reason: 'Diagnose user permissions issue',
    },
    user: { id: targetUserId },
  };

  auditSupportActions(mockReq, mockRes, () => {});
  assert.ok(finishCallbacks.length > 0, 'finish listener registered');

  // Trigger response finish event
  for (const cb of finishCallbacks) {
    await cb();
  }

  // Small sleep to ensure async write finishes
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Query audit logs to verify dual attribution
  const [log] = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.supportSessionId, session.sessionId))
    .limit(1);

  assert.ok(log, 'Audit log entry should exist');
  assert.equal(log.tenantId, testTenantId);
  assert.equal(log.actorType, 'PLATFORM_STAFF');
  assert.equal(log.actorStaffId, superAdminStaffId);
  assert.equal(log.supportSessionId, session.sessionId);
  assert.equal(log.effectiveUserId, targetUserId);
  assert.equal(log.source, 'IMPERSONATION');
  assert.equal(log.action, 'SUPPORT.POST./api/v1/files/upload-confirm');
});
