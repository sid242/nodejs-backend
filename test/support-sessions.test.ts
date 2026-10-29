import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import {
  platformRoles,
  platformStaff,
  platformSupportSessions,
  tenants,
} from '../src/db/schema/index';
import { AppError } from '../src/lib/errors';
import {
  blockInSupportSession,
  requireSupportOrUser,
} from '../src/middleware/support';
import {
  issueSupportToken,
  verifySupportToken,
} from '../src/modules/auth/tokens';
import * as platformRepo from '../src/modules/platform/platform.repository';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('issueSupportToken signs and verifySupportToken verifies SUPPORT JWT', () => {
  const sessionId = randomUUID();
  const staffId = randomUUID();
  const tenantId = randomUUID();
  const targetUserId = randomUUID();

  const { token, expiresInSeconds } = issueSupportToken(
    {
      sess: sessionId,
      staffId,
      tenantId,
      mode: 'AS_MEMBER',
      scope: 'READ_ONLY',
      targetUserId,
    },
    30,
  );

  assert.ok(token);
  assert.equal(expiresInSeconds, 1800);

  const decoded = verifySupportToken(token);
  assert.equal(decoded.typ, 'SUPPORT');
  assert.equal(decoded.sess, sessionId);
  assert.equal(decoded.staffId, staffId);
  assert.equal(decoded.tenantId, tenantId);
  assert.equal(decoded.mode, 'AS_MEMBER');
  assert.equal(decoded.scope, 'READ_ONLY');
  assert.equal(decoded.sub, targetUserId);
});

test('requireSupportOrUser denies request when token is missing', async () => {
  const req: any = { headers: {}, cookies: {} };
  let caughtError: any = null;
  const next = (err?: any) => {
    caughtError = err;
  };

  await requireSupportOrUser(req, {} as any, next);
  assert.ok(caughtError instanceof AppError);
  assert.equal(caughtError.status, 401);
});

test('requireSupportOrUser blocks mutating requests (POST) in READ_ONLY support scope', async () => {
  // 1. Get or create a platform role
  let [role] = await db.select().from(platformRoles).limit(1);
  if (!role) {
    [role] = await db
      .insert(platformRoles)
      .values({
        key: `ROLE_${Date.now()}`,
        name: 'Test Role',
        description: 'Test platform role',
      })
      .returning();
  }
  assert.ok(role, 'role should exist');

  // 2. Create platform staff
  const [staff] = await db
    .insert(platformStaff)
    .values({
      email: `staff-${Date.now()}@example.com`,
      displayName: 'Support Agent',
      passwordHash: '$2a$12$dummyhashforstaff0000000000000000000000000000000000',
      roleId: role.id,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(staff, 'staff should exist');

  // 3. Create tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Support Target Org',
      slug: `support-target-${Date.now()}`,
      status: 'ACTIVE',
      plan: 'PRO',
    })
    .returning();
  assert.ok(tenant, 'tenant should exist');

  // 4. Create active READ_ONLY support session
  const session = await platformRepo.createSupportSession({
    staffId: staff.id,
    tenantId: tenant.id,
    mode: 'TENANT_SCOPED',
    scope: 'READ_ONLY',
    status: 'ACTIVE',
    reason: 'Investigating billing issue',
    expiresAt: new Date(Date.now() + 60000),
  });

  const { token } = issueSupportToken(
    {
      sess: session.id,
      staffId: staff.id,
      tenantId: tenant.id,
      mode: 'TENANT_SCOPED',
      scope: 'READ_ONLY',
    },
    30,
  );

  try {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
    };

    let caughtError: any = null;
    const next = (err?: any) => {
      caughtError = err;
    };

    await requireSupportOrUser(req, {} as any, next);
    assert.ok(caughtError instanceof AppError);
    assert.equal(caughtError.status, 403);
    assert.match(caughtError.message, /READ_ONLY support session cannot perform mutating/i);
  } finally {
    await db.delete(platformSupportSessions).where(eq(platformSupportSessions.id, session.id));
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await db.delete(platformStaff).where(eq(platformStaff.id, staff.id));
  }
});

test('requireSupportOrUser denies expired or non-active support session (fail-closed)', async () => {
  let [role] = await db.select().from(platformRoles).limit(1);
  if (!role) {
    [role] = await db
      .insert(platformRoles)
      .values({
        key: `ROLE_${Date.now()}`,
        name: 'Test Role',
        description: 'Test platform role',
      })
      .returning();
  }
  assert.ok(role, 'role should exist');

  const [staff] = await db
    .insert(platformStaff)
    .values({
      email: `staff-expired-${Date.now()}@example.com`,
      displayName: 'Expired Staff Agent',
      passwordHash: '$2a$12$dummyhashforstaff0000000000000000000000000000000000',
      roleId: role.id,
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(staff, 'staff should exist');

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Expired Target Org',
      slug: `expired-target-${Date.now()}`,
      status: 'ACTIVE',
      plan: 'FREE',
    })
    .returning();
  assert.ok(tenant, 'tenant should exist');

  const session = await platformRepo.createSupportSession({
    staffId: staff.id,
    tenantId: tenant.id,
    mode: 'TENANT_SCOPED',
    scope: 'FULL',
    status: 'EXPIRED',
    reason: 'Old session',
    expiresAt: new Date(Date.now() - 60000),
  });

  const { token } = issueSupportToken(
    {
      sess: session.id,
      staffId: staff.id,
      tenantId: tenant.id,
      mode: 'TENANT_SCOPED',
      scope: 'FULL',
    },
    30,
  );

  try {
    const req: any = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cookies: {},
    };

    let caughtError: any = null;
    const next = (err?: any) => {
      caughtError = err;
    };

    await requireSupportOrUser(req, {} as any, next);
    assert.ok(caughtError instanceof AppError);
    assert.equal(caughtError.status, 403);
  } finally {
    await db.delete(platformSupportSessions).where(eq(platformSupportSessions.id, session.id));
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await db.delete(platformStaff).where(eq(platformStaff.id, staff.id));
  }
});

test('blockInSupportSession rejects sensitive actions during support session', () => {
  const guard = blockInSupportSession('Password change');

  const supportReq: any = { isSupportSession: true };
  let caughtError: any = null;
  guard(supportReq, {} as any, (err?: any) => {
    caughtError = err;
  });

  assert.ok(caughtError instanceof AppError);
  assert.equal(caughtError.status, 403);
  assert.match(caughtError.message, /Password change cannot be performed while inside a support session/);

  // Normal user request succeeds
  const userReq: any = { isSupportSession: false };
  let passed = false;
  guard(userReq, {} as any, (err?: any) => {
    assert.ifError(err);
    passed = true;
  });
  assert.ok(passed);
});
