import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db.js';
import { closeRedisClients } from '../src/config/redis.js';
import { platformStaff, tenantMembers, tenants, users } from '../src/db/schema/index.js';
import { AppError } from '../src/lib/errors.js';
import { requirePlatformAuth, requirePlatformPermission } from '../src/middleware/platform.js';
import { resolveTenantContext } from '../src/middleware/tenant.js';
import * as authRepo from '../src/modules/auth/auth.repository.js';
import {
  createMagicLinkToken,
  verifyAndConsumeMagicLinkToken,
} from '../src/modules/auth/tokens.js';
import * as plansService from '../src/modules/plans/plans.service.js';
import * as platformService from '../src/modules/platform/platform.service.js';
import { rbacRepo } from '../src/modules/rbac/rbac.repository.js';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository.js';
import * as tenantsService from '../src/modules/tenants/tenants.service.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Release Checklist 1 & 2: Cross-Tenant Isolation & Header Tampering Prevention', async () => {
  // Scenario: Real tenant A and real tenant B exist. User is a member of A only.
  // User attempts to query tenant B using x-tenant-id header. Must throw 403 Forbidden.
  const [user] = await db.select().from(users).limit(1);
  assert.ok(user, 'Seeded user required');

  const tenantA = await tenantsRepo.createTenant({
    name: 'Isolation Tenant A',
    slug: `iso-a-${Date.now()}`,
    plan: 'PRO',
  });
  const tenantB = await tenantsRepo.createTenant({
    name: 'Isolation Tenant B',
    slug: `iso-b-${Date.now()}`,
    plan: 'PRO',
  });

  const memberA = await tenantsRepo.addTenantMember({
    tenantId: tenantA.id,
    userId: user.id,
    status: 'ACTIVE',
  });

  try {
    const req: any = {
      user: { id: user.id, role: 'USER', status: 'ACTIVE' },
      headers: { 'x-tenant-id': tenantB.id },
      params: {},
      query: {},
    };
    const res: any = {};
    let caughtError: any = null;

    await resolveTenantContext(req, res, (err?: any) => {
      caughtError = err;
    });

    assert.ok(caughtError instanceof AppError);
    assert.equal(caughtError.status, 403);
    assert.ok(caughtError.message.includes('not a member of this tenant'));
  } finally {
    await db.delete(tenantMembers).where(eq(tenantMembers.id, memberA.id));
    await db.delete(tenants).where(inArray(tenants.id, [tenantA.id, tenantB.id]));
  }
});

test('Release Checklist 3: Platform Privilege Separation (Tenant Admin cannot access Platform API)', async () => {
  const req: any = {
    user: { id: randomUUID(), role: 'USER', status: 'ACTIVE' },
    headers: {},
    cookies: {},
  };
  const res: any = {};
  let caughtError: any = null;

  await requirePlatformAuth(req, res, (err?: any) => {
    caughtError = err;
  });

  assert.ok(caughtError instanceof AppError);
  assert.equal(caughtError.status, 401);
  assert.ok(caughtError.message.includes('Platform staff authentication required'));

  let permError: any = null;
  const permGuard = requirePlatformPermission('tenants::manage');
  permGuard(req, res, (err?: any) => {
    permError = err;
  });
  assert.ok(permError instanceof AppError);
  assert.equal(permError.status, 401);
});

test('Release Checklist 4: Duplicate Tenant Slugs are Rejected', async () => {
  const [staff] = await db.select().from(platformStaff).limit(1);
  const [existing] = await db.select().from(tenants).limit(1);

  if (existing && staff) {
    await assert.rejects(
      async () => {
        await platformService.provisionTenant(staff.id, {
          name: 'Conflicting Workspace',
          slug: existing.slug,
          ownerEmail: `new-${Date.now()}@example.com`,
          plan: 'PRO',
          databaseMode: 'shared',
          timezone: 'UTC',
        });
      },
      (err: any) => {
        assert.equal(err.status, 409);
        assert.ok(err.message.includes('already exists') || err.message.includes('already taken'));
        return true;
      },
    );
  }
});

test('Release Checklist 5: Duplicate Active Memberships are Prevented', async () => {
  const [user] = await db.select().from(users).limit(1);
  const [tenant] = await db.select().from(tenants).limit(1);

  if (user && tenant) {
    let existingMember = await tenantsRepo.findTenantMember(tenant.id, user.id);
    if (!existingMember) {
      existingMember = await tenantsRepo.addTenantMember({
        tenantId: tenant.id,
        userId: user.id,
        status: 'ACTIVE',
      });
    }

    await assert.rejects(
      async () => {
        await tenantsService.addMemberToTenant(tenant.id, user.id, user.email);
      },
      (err: any) => {
        assert.equal(err.status, 409);
        assert.ok(err.message.includes('already a member of this tenant'));
        return true;
      },
    );
  }
});

test('Release Checklist 6 & 7: Expired or Single-Use Invitation Tokens Cannot be Reused', async () => {
  const [user] = await db.select().from(users).limit(1);
  const [tenant] = await db.select().from(tenants).limit(1);

  if (user && tenant) {
    const token = await createMagicLinkToken(user.id, 60, tenant.id);
    const consumed = await verifyAndConsumeMagicLinkToken(token);
    assert.equal(consumed.userId, user.id);
    assert.equal(consumed.target, tenant.id);

    // Immediate second consumption MUST FAIL
    await assert.rejects(
      async () => {
        await verifyAndConsumeMagicLinkToken(token);
      },
      (err: any) => {
        assert.equal(err.status, 400);
        assert.ok(
          err.message.includes('already been used') ||
            err.message.includes('invalid or has expired'),
        );
        return true;
      },
    );
  }
});

test('Release Checklist 8: Removing Membership Preserves Global User and Other Memberships', async () => {
  const uniqueEmail = `global-user-${Date.now()}@example.com`;
  const [createdUser] = await db
    .insert(users)
    .values({
      email: uniqueEmail,
      name: 'Global Independent User',
      passwordHash: '$2a$12$dummyhashforpreservationtesting00000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(createdUser);

  const tenantA = await tenantsRepo.createTenant({
    name: 'Preserve Tenant A',
    slug: `preserve-a-${Date.now()}`,
    plan: 'PRO',
  });
  const tenantB = await tenantsRepo.createTenant({
    name: 'Preserve Tenant B',
    slug: `preserve-b-${Date.now()}`,
    plan: 'PRO',
  });

  const memberA = await tenantsRepo.addTenantMember({
    tenantId: tenantA.id,
    userId: createdUser.id,
    status: 'ACTIVE',
  });
  const memberB = await tenantsRepo.addTenantMember({
    tenantId: tenantB.id,
    userId: createdUser.id,
    status: 'ACTIVE',
  });

  // Remove membership from Tenant A
  await tenantsRepo.removeTenantMember(tenantA.id, memberA.id);

  const lookupA = await tenantsRepo.findTenantMember(tenantA.id, createdUser.id);
  assert.equal(lookupA, null);

  const lookupB = await tenantsRepo.findTenantMember(tenantB.id, createdUser.id);
  assert.ok(lookupB !== null);
  assert.equal(lookupB.id, memberB.id);
  assert.equal(lookupB.status, 'ACTIVE');

  const globalUserLookup = await authRepo.findById(createdUser.id);
  assert.ok(globalUserLookup !== null);
  assert.equal(globalUserLookup.email, uniqueEmail);

  // Cleanup
  await db.delete(tenantMembers).where(eq(tenantMembers.userId, createdUser.id));
  await db.delete(tenants).where(inArray(tenants.id, [tenantA.id, tenantB.id]));
  await db.delete(users).where(eq(users.id, createdUser.id));
});

test('Release Checklist 9: Last-Owner Invariant Blocks Demotion or Removal', async () => {
  const tenantId = randomUUID();
  const operatorUserId = randomUUID();
  const targetMemberUserId = randomUUID();
  const memberId = randomUUID();

  const origFindMember = tenantsRepo.findTenantMemberById;
  const origFindOperator = tenantsRepo.findTenantMember;
  const origGetRoles = rbacRepo.getMemberRoles;
  const origCountOwners = rbacRepo.countTenantOwners;

  try {
    (tenantsRepo as any).findTenantMemberById = async (id: string) => ({
      id,
      tenantId,
      userId: targetMemberUserId,
      status: 'ACTIVE',
    });

    (tenantsRepo as any).findTenantMember = async (tId: string, uId: string) => ({
      id: randomUUID(),
      tenantId: tId,
      userId: uId,
      status: 'ACTIVE',
    });

    (rbacRepo as any).getMemberRoles = async () => [
      {
        id: randomUUID(),
        tenantId,
        name: 'OWNER',
        isSystem: true,
      },
    ];

    (rbacRepo as any).countTenantOwners = async () => 1;

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
  } finally {
    (tenantsRepo as any).findTenantMemberById = origFindMember;
    (tenantsRepo as any).findTenantMember = origFindOperator;
    (rbacRepo as any).getMemberRoles = origGetRoles;
    (rbacRepo as any).countTenantOwners = origCountOwners;
  }
});

test('Release Checklist 10: Suspended Tenants Lose Access', async () => {
  const [user] = await db.select().from(users).limit(1);
  assert.ok(user, 'Seeded user required');

  const tenant = await tenantsRepo.createTenant({
    name: 'Suspended Real Corp',
    slug: `susp-${Date.now()}`,
    plan: 'PRO',
  });

  // Transition tenant to SUSPENDED in DB
  await db.update(tenants).set({ status: 'SUSPENDED' }).where(eq(tenants.id, tenant.id));

  try {
    const req: any = {
      user: { id: user.id, role: 'USER', status: 'ACTIVE' },
      headers: { 'x-tenant-id': tenant.id },
      params: {},
      query: {},
    };
    const res: any = {};
    let caughtError: any = null;

    await resolveTenantContext(req, res, (err?: any) => {
      caughtError = err;
    });

    assert.ok(caughtError instanceof AppError);
    assert.equal(caughtError.status, 403);
    assert.ok(caughtError.message.includes('Tenant is currently suspended'));
  } finally {
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
  }
});

test('Release Checklist 11: SaaS Plan Seat Limits Block Over-Quota Member Invites', async () => {
  // Create a real free-tier tenant (5 seats max)
  const tenant = await tenantsRepo.createTenant({
    name: 'Quota Test Workspace',
    slug: `quota-${Date.now()}`,
    plan: 'FREE',
  });

  const memberIds: string[] = [];
  try {
    // Add 5 members to reach limit
    for (let i = 0; i < 5; i++) {
      const uniqueEmail = `quota-user-${i}-${Date.now()}@example.com`;
      const [u] = await db
        .insert(users)
        .values({
          email: uniqueEmail,
          name: `Quota User ${i}`,
          passwordHash: '$2a$12$dummyhashforquota000000000000000000000000000000000',
        })
        .returning();
      assert.ok(u);

      const member = await tenantsRepo.addTenantMember({
        tenantId: tenant.id,
        userId: u.id,
        status: 'ACTIVE',
      });
      memberIds.push(member.id);
    }

    // Now calling checkTenantSeatLimit must reject with 403 Forbidden
    await assert.rejects(
      async () => {
        await plansService.checkTenantSeatLimit(tenant.id);
      },
      (err: any) => {
        assert.equal(err.status, 403);
        assert.ok(err.message.includes('Plan seat limit reached'));
        return true;
      },
    );
  } finally {
    if (memberIds.length > 0) {
      await db.delete(tenantMembers).where(inArray(tenantMembers.id, memberIds));
    }
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
  }
});

test('Release Checklist 12: Private Asset Isolation (S3 Key Namespacing)', async () => {
  const [tenant] = await db.select().from(tenants).limit(1);
  assert.ok(tenant, 'Seeded tenant required');

  const uploadResult = await tenantsService.generateBrandingUploadUrl(tenant.id, {
    filename: 'logo.png',
    contentType: 'image/png',
    type: 'logo',
  });

  assert.ok(uploadResult.key.startsWith(`tenants/${tenant.id}/branding/logo-`));
  assert.ok(uploadResult.key.endsWith('.png'));
});
