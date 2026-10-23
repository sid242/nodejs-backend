import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { closeDb, db } from '../src/config/db.js';
import { closeRedisClients } from '../src/config/redis.js';
import { platformStaff } from '../src/db/schema/index.js';
import {
  listPlatformTenantsQueryDto,
  provisionTenantDto,
  suspendTenantDto,
} from '../src/modules/platform/platform.dto.js';
import * as platformRepo from '../src/modules/platform/platform.repository.js';
import * as platformService from '../src/modules/platform/platform.service.js';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository.js';
import * as tenantsService from '../src/modules/tenants/tenants.service.js';
import { createMagicLinkToken } from '../src/modules/auth/tokens.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('provisionTenantDto schema validates workspace name, slug format, and owner email', () => {
  // Valid payload
  const valid = provisionTenantDto.safeParse({
    name: 'Acme Laboratories',
    slug: 'acme-labs-2026',
    ownerEmail: 'founder@acmelabs.com',
    plan: 'PRO',
    databaseMode: 'shared',
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.name, 'Acme Laboratories');
    assert.equal(valid.data.slug, 'acme-labs-2026');
    assert.equal(valid.data.timezone, 'UTC');
  }

  // Invalid slugs
  const invalidSlugSpace = provisionTenantDto.safeParse({
    name: 'Acme',
    slug: 'acme labs',
    ownerEmail: 'test@example.com',
  });
  assert.equal(invalidSlugSpace.success, false);

  const invalidSlugUpper = provisionTenantDto.safeParse({
    name: 'Acme',
    slug: 'AcmeLabs',
    ownerEmail: 'test@example.com',
  });
  assert.equal(invalidSlugUpper.success, false);

  // Invalid email
  const invalidEmail = provisionTenantDto.safeParse({
    name: 'Acme',
    slug: 'acme-labs',
    ownerEmail: 'not-an-email',
  });
  assert.equal(invalidEmail.success, false);
});

test('listPlatformTenantsQueryDto validates pagination and enum filters', () => {
  const parsed = listPlatformTenantsQueryDto.parse({
    page: '2',
    limit: '25',
    status: 'ACTIVE',
    databaseMode: 'dedicated',
  });
  assert.equal(parsed.page, 2);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.status, 'ACTIVE');
  assert.equal(parsed.databaseMode, 'dedicated');
});

test('suspendTenantDto requires a descriptive reason', () => {
  const valid = suspendTenantDto.safeParse({ reason: 'Overdue billing invoice #4928' });
  assert.equal(valid.success, true);

  const invalid = suspendTenantDto.safeParse({ reason: 'no' });
  assert.equal(invalid.success, false);
});

test('platformService.provisionTenant executes transactional setup with owner invitation', async () => {
  await platformService.seedPlatformDefaults();
  const superAdminRole = await platformRepo.findRoleByKey('SUPER_ADMIN');
  assert.ok(superAdminRole);

  const staffEmail = `operator-${Date.now()}@platform.internal`;
  const staff = await platformRepo.createStaff({
    email: staffEmail,
    displayName: 'Lead Platform Operator',
    passwordHash: 'dummy_hash',
    roleId: superAdminRole.id,
    status: 'ACTIVE',
  });
  const staffId = staff.id;

  const testSlug = `test-org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ownerEmail = `owner-${Date.now()}@example.com`;

  const result = await platformService.provisionTenant(
    staffId,
    {
      name: 'Test Tenant Org',
      slug: testSlug,
      ownerEmail,
      plan: 'FREE',
      timezone: 'America/New_York',
      databaseMode: 'shared',
      notes: 'Initial enterprise onboarding trial',
    },
    'req-test-provision-123',
  );

  assert.ok(result.tenant?.id);
  assert.equal(result.tenant.name, 'Test Tenant Org');
  assert.equal(result.tenant.slug, testSlug);
  assert.equal(result.tenant.status, 'ACTIVE');
  assert.equal(result.tenant.plan, 'FREE');
  assert.equal(result.owner.email, ownerEmail);
  assert.ok(result.inviteToken);
  assert.ok(result.inviteUrl.includes(result.inviteToken));

  // Verify tenant was inserted and is retrievable
  const fetched = await platformRepo.findTenantDetailById(result.tenant.id);
  assert.ok(fetched);
  assert.equal(fetched.name, 'Test Tenant Org');
  assert.equal(fetched.slug, testSlug);
  assert.equal(fetched.ownerEmail, ownerEmail);
  assert.equal(fetched.memberCount, 1);
  assert.ok(fetched.branding);
  assert.equal(fetched.branding.companyName, 'Test Tenant Org');

  // Verify duplicate slug rejection
  await assert.rejects(
    async () => {
      await platformService.provisionTenant(staffId, {
        name: 'Duplicate Tenant',
        slug: testSlug,
        ownerEmail: 'other@example.com',
        plan: 'FREE',
        databaseMode: 'shared',
        timezone: 'UTC',
      });
    },
    (err: any) => {
      assert.equal(err.status, 409);
      assert.ok(err.message.includes('already exists'));
      return true;
    },
  );

  // Verify suspension and reactivation lifecycle
  const suspended = await platformService.suspendTenant(
    staffId,
    result.tenant.id,
    'Terms of Service Investigation',
    'req-suspend-123',
  );
  assert.equal(suspended?.status, 'SUSPENDED');

  // Second suspension should fail
  await assert.rejects(
    async () => {
      await platformService.suspendTenant(staffId, result.tenant.id, 'Double suspend');
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('already suspended'));
      return true;
    },
  );

  // Reactivate
  const reactivated = await platformService.activateTenant(
    staffId,
    result.tenant.id,
    'Investigation resolved successfully',
    'req-activate-123',
  );
  assert.equal(reactivated?.status, 'ACTIVE');
});

test('invitation tokens are explicitly bound to workspace and prevent cross-tenant activation', async () => {
  const [staff] = await db.select().from(platformStaff).limit(1);
  const staffId = staff?.id ?? randomUUID();

  const userEmail = `multi-invite-${Date.now()}@example.com`;

  // Provision Workspace A
  const resA = await platformService.provisionTenant(staffId, {
    name: 'Workspace Alpha',
    slug: `alpha-${Date.now()}`,
    ownerEmail: userEmail,
    plan: 'FREE',
    databaseMode: 'shared',
    timezone: 'UTC',
  });

  // Provision Workspace B with same user
  const resB = await platformService.provisionTenant(staffId, {
    name: 'Workspace Beta',
    slug: `beta-${Date.now()}`,
    ownerEmail: userEmail,
    plan: 'FREE',
    databaseMode: 'shared',
    timezone: 'UTC',
  });

  // Check initial state: user has two memberships, both INVITED
  const membershipsBefore = await tenantsRepo.findMembershipsByUserId(resA.owner.id);
  const memA = membershipsBefore.find((m) => m.tenantId === resA.tenant.id);
  const memB = membershipsBefore.find((m) => m.tenantId === resB.tenant.id);
  assert.equal(memA?.status, 'INVITED');
  assert.equal(memB?.status, 'INVITED');

  // Verify that passing mismatched expectedTenantId throws 403 Forbidden
  const testMismatchToken = await createMagicLinkToken(resA.owner.id, 3600, resA.tenant.id);
  await assert.rejects(
    async () => {
      await tenantsService.acceptTenantInvitation(testMismatchToken, resB.tenant.id);
    },
    (err: any) => {
      assert.equal(err.status, 403);
      assert.ok(err.message.includes('does not belong to the requested workspace'));
      return true;
    },
  );

  // Accept invitation for Workspace A using resA.inviteToken
  const acceptRes = await tenantsService.acceptTenantInvitation(resA.inviteToken, resA.tenant.id);
  assert.equal(acceptRes.user.email, userEmail);
  assert.equal(acceptRes.activeTenantId, resA.tenant.id);

  // Assert isolation: Workspace A is now ACTIVE, but Workspace B MUST STILL BE INVITED
  const membershipsAfter = await tenantsRepo.findMembershipsByUserId(resA.owner.id);
  const memAAfter = membershipsAfter.find((m) => m.tenantId === resA.tenant.id);
  const memBAfter = membershipsAfter.find((m) => m.tenantId === resB.tenant.id);
  assert.equal(memAAfter?.status, 'ACTIVE');
  assert.equal(memBAfter?.status, 'INVITED');
});

