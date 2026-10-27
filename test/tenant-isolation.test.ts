import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db.js';
import { closeRedisClients } from '../src/config/redis.js';
import { tenantMembers, tenants, users } from '../src/db/schema/index.js';
import { AppError } from '../src/lib/errors.js';
import { requireTenant, resolveTenantContext } from '../src/middleware/tenant.js';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Multi-Tenant Edge Case 1: Unauthenticated and zero-membership users without tenant context', async () => {
  // 1a: Unauthenticated request - resolveTenantContext passes through silently, requireTenant returns 401
  const reqUnauth: any = { headers: {}, params: {}, query: {} };
  const res: any = {};
  let caughtUnauthErr: any = null;

  await resolveTenantContext(reqUnauth, res, (err) => {
    caughtUnauthErr = err;
  });
  assert.equal(
    caughtUnauthErr,
    undefined,
    'resolveTenantContext should pass through unauthenticated requests',
  );
  assert.equal(
    reqUnauth.tenant,
    undefined,
    'req.tenant must be undefined for unauthenticated requests',
  );

  let requireTenantErr: any = null;
  await requireTenant(reqUnauth, res, (err) => {
    requireTenantErr = err;
  });
  assert.ok(requireTenantErr instanceof AppError);
  assert.equal(
    requireTenantErr.status,
    401,
    'requireTenant must return 401 for unauthenticated requests',
  );

  // 1b: Authenticated user with 0 tenant memberships and no tenant header/param
  const [userNoTenants] = await db
    .insert(users)
    .values({
      email: `zero-member-${Date.now()}@example.com`,
      name: 'Zero Tenant User',
      passwordHash: '$2a$12$dummyhashforzeromembertest000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(userNoTenants);

  try {
    const reqAuth: any = {
      user: { id: userNoTenants.id, role: 'USER', status: 'ACTIVE' },
      headers: {},
      params: {},
      query: {},
    };
    let caughtAuthErr: any = null;

    await resolveTenantContext(reqAuth, res, (err) => {
      caughtAuthErr = err;
    });
    assert.equal(caughtAuthErr, undefined);
    assert.equal(
      reqAuth.tenant,
      undefined,
      'req.tenant must remain undefined when user has 0 tenants',
    );

    let requireTenantZeroErr: any = null;
    await requireTenant(reqAuth, res, (err) => {
      requireTenantZeroErr = err;
    });
    assert.ok(requireTenantZeroErr instanceof AppError);
    assert.equal(
      requireTenantZeroErr.status,
      400,
      'requireTenant must return 400 when no tenant can be resolved',
    );
    assert.ok(requireTenantZeroErr.message.includes('Tenant identifier missing'));
  } finally {
    await db.delete(users).where(eq(users.id, userNoTenants.id));
  }
});

test('Multi-Tenant Edge Case 2: User with exactly 1 active tenant auto-resolves when x-tenant-id is omitted', async () => {
  const [singleTenantUser] = await db
    .insert(users)
    .values({
      email: `single-tenant-${Date.now()}@example.com`,
      name: 'Single Tenant User',
      passwordHash: '$2a$12$dummyhashforsingletenanttest000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(singleTenantUser);

  const tenantSingle = await tenantsRepo.createTenant({
    name: 'Auto-Resolve Solo Tenant',
    slug: `auto-solo-${Date.now()}`,
    plan: 'PRO',
  });

  const membership = await tenantsRepo.addTenantMember({
    tenantId: tenantSingle.id,
    userId: singleTenantUser.id,
    status: 'ACTIVE',
  });

  try {
    // Request completely omits x-tenant-id header and params
    const req: any = {
      user: { id: singleTenantUser.id, role: 'USER', status: 'ACTIVE' },
      headers: {},
      params: {},
      query: {},
    };
    const res: any = {};
    let errResult: any = null;

    await requireTenant(req, res, (err) => {
      errResult = err;
    });

    assert.equal(
      errResult,
      undefined,
      'requireTenant should succeed via single-tenant auto-resolution',
    );
    assert.ok(req.tenant, 'req.tenant must be populated');
    assert.equal(req.tenant.id, tenantSingle.id);
    assert.equal(req.tenant.slug, tenantSingle.slug);
    assert.ok(req.membership, 'req.membership must be populated');
    assert.equal(req.membership.id, membership.id);
    assert.equal(req.membership.status, 'ACTIVE');
  } finally {
    await db.delete(tenantMembers).where(eq(tenantMembers.id, membership.id));
    await db.delete(tenants).where(eq(tenants.id, tenantSingle.id));
    await db.delete(users).where(eq(users.id, singleTenantUser.id));
  }
});

test('Multi-Tenant Edge Case 3: User with multiple active tenants requires explicit x-tenant-id (no auto-resolution)', async () => {
  const [multiTenantUser] = await db
    .insert(users)
    .values({
      email: `multi-tenant-${Date.now()}@example.com`,
      name: 'Multi Tenant User',
      passwordHash: '$2a$12$dummyhashformultitenanttest000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(multiTenantUser);

  const tenant1 = await tenantsRepo.createTenant({
    name: 'Multi Tenant Org 1',
    slug: `multi-1-${Date.now()}`,
    plan: 'PRO',
  });
  const tenant2 = await tenantsRepo.createTenant({
    name: 'Multi Tenant Org 2',
    slug: `multi-2-${Date.now()}`,
    plan: 'FREE',
  });

  const member1 = await tenantsRepo.addTenantMember({
    tenantId: tenant1.id,
    userId: multiTenantUser.id,
    status: 'ACTIVE',
  });
  const member2 = await tenantsRepo.addTenantMember({
    tenantId: tenant2.id,
    userId: multiTenantUser.id,
    status: 'ACTIVE',
  });

  try {
    // 3a: Omitting x-tenant-id when multiple active tenants exist -> no auto-resolution, requireTenant throws 400
    const reqOmitted: any = {
      user: { id: multiTenantUser.id, role: 'USER', status: 'ACTIVE' },
      headers: {},
      params: {},
      query: {},
    };
    const res: any = {};
    let errOmitted: any = null;

    await resolveTenantContext(reqOmitted, res, (err) => {
      errOmitted = err;
    });
    assert.equal(errOmitted, undefined);
    assert.equal(
      reqOmitted.tenant,
      undefined,
      'Must not arbitrarily pick a tenant when multiple exist',
    );

    let requireTenantErr: any = null;
    await requireTenant(reqOmitted, res, (err) => {
      requireTenantErr = err;
    });
    assert.ok(requireTenantErr instanceof AppError);
    assert.equal(requireTenantErr.status, 400, 'Must require explicit tenant identifier');

    // 3b: Explicitly providing x-tenant-id for Tenant 2 succeeds
    const reqExplicit: any = {
      user: { id: multiTenantUser.id, role: 'USER', status: 'ACTIVE' },
      headers: { 'x-tenant-id': tenant2.id },
      params: {},
      query: {},
    };
    let errExplicit: any = null;

    await requireTenant(reqExplicit, res, (err) => {
      errExplicit = err;
    });
    assert.equal(errExplicit, undefined);
    assert.equal(reqExplicit.tenant.id, tenant2.id);
    assert.equal(reqExplicit.membership.id, member2.id);
  } finally {
    await db.delete(tenantMembers).where(inArray(tenantMembers.id, [member1.id, member2.id]));
    await db.delete(tenants).where(inArray(tenants.id, [tenant1.id, tenant2.id]));
    await db.delete(users).where(eq(users.id, multiTenantUser.id));
  }
});

test('Multi-Tenant Edge Case 4: Nonexistent tenant ID returns 404 Not Found', async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `notfound-user-${Date.now()}@example.com`,
      name: 'NotFound Test User',
      passwordHash: '$2a$12$dummyhashfornotfoundtest00000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(user);

  try {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const req: any = {
      user: { id: user.id, role: 'USER', status: 'ACTIVE' },
      headers: { 'x-tenant-id': fakeUuid },
      params: {},
      query: {},
    };
    const res: any = {};
    let caughtErr: any = null;

    await resolveTenantContext(req, res, (err) => {
      caughtErr = err;
    });

    assert.ok(caughtErr instanceof AppError);
    assert.equal(caughtErr.status, 404, 'Must return 404 for nonexistent tenant');
    assert.equal(caughtErr.message, 'Tenant organization not found');
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
  }
});

test('Multi-Tenant Edge Case 5: Tenant slug supplied instead of UUID in x-tenant-id resolves properly', async () => {
  const [slugUser] = await db
    .insert(users)
    .values({
      email: `slug-user-${Date.now()}@example.com`,
      name: 'Slug Resolution User',
      passwordHash: '$2a$12$dummyhashforslugresolutiontest00000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(slugUser);

  const slugName = `slug-tenant-${Date.now()}`;
  const tenantSlug = await tenantsRepo.createTenant({
    name: 'Slug Resolved Tenant Org',
    slug: slugName,
    plan: 'ENTERPRISE',
  });

  const member = await tenantsRepo.addTenantMember({
    tenantId: tenantSlug.id,
    userId: slugUser.id,
    status: 'ACTIVE',
  });

  try {
    // Provide slug rather than UUID in x-tenant-id header
    const req: any = {
      user: { id: slugUser.id, role: 'USER', status: 'ACTIVE' },
      headers: { 'x-tenant-id': slugName },
      params: {},
      query: {},
    };
    const res: any = {};
    let errResult: any = null;

    await resolveTenantContext(req, res, (err) => {
      errResult = err;
    });

    assert.equal(errResult, undefined);
    assert.ok(req.tenant);
    assert.equal(req.tenant.id, tenantSlug.id, 'Should resolve the tenant UUID from the slug');
    assert.equal(req.tenant.slug, slugName);
    assert.equal(req.membership.id, member.id);
  } finally {
    await db.delete(tenantMembers).where(eq(tenantMembers.id, member.id));
    await db.delete(tenants).where(eq(tenants.id, tenantSlug.id));
    await db.delete(users).where(eq(users.id, slugUser.id));
  }
});

test('Multi-Tenant Edge Case 6: User attempting to access a tenant they do not belong to returns 403 Forbidden', async () => {
  const [intruderUser] = await db
    .insert(users)
    .values({
      email: `intruder-${Date.now()}@example.com`,
      name: 'Intruder User',
      passwordHash: '$2a$12$dummyhashforintrudertest00000000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(intruderUser);

  const victimTenant = await tenantsRepo.createTenant({
    name: 'Victim Organization',
    slug: `victim-${Date.now()}`,
    plan: 'PRO',
  });

  try {
    // User attempts to query victim tenant where they have no membership
    const req: any = {
      user: { id: intruderUser.id, role: 'USER', status: 'ACTIVE' },
      headers: { 'x-tenant-id': victimTenant.id },
      params: {},
      query: {},
    };
    const res: any = {};
    let caughtErr: any = null;

    await resolveTenantContext(req, res, (err) => {
      caughtErr = err;
    });

    assert.ok(caughtErr instanceof AppError);
    assert.equal(caughtErr.status, 403, 'Must return 403 Forbidden');
    assert.ok(
      caughtErr.message.includes('You are not a member of this tenant'),
      'Must contain clear non-member isolation message',
    );
  } finally {
    await db.delete(tenants).where(eq(tenants.id, victimTenant.id));
    await db.delete(users).where(eq(users.id, intruderUser.id));
  }
});
