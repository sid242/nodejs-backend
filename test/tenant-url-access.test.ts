import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import { isOriginAllowed, addCorsCustomDomain, removeCorsCustomDomain } from '../src/lib/cors';
import { tenantSlugSchema, isReservedSlug } from '../src/modules/tenants/tenants.dto';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository';
import * as tenantsService from '../src/modules/tenants/tenants.service';
import { getEffectiveUrlMode } from '../src/modules/tenants/tenant-url.service';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('tenantSlugSchema strictly enforces DNS-label format and reserved slugs', () => {
  // Valid slugs
  assert.equal(tenantSlugSchema.safeParse('acme-corp').success, true);
  assert.equal(tenantSlugSchema.safeParse('workspace123').success, true);
  assert.equal(tenantSlugSchema.safeParse('my-team').success, true);

  // Invalid: too short
  assert.equal(tenantSlugSchema.safeParse('ab').success, false);

  // Invalid: starts or ends with hyphen
  assert.equal(tenantSlugSchema.safeParse('-acme').success, false);
  assert.equal(tenantSlugSchema.safeParse('acme-').success, false);

  // Invalid: punycode reserve (double hyphen at index 2-3)
  assert.equal(tenantSlugSchema.safeParse('ab--cd').success, false);

  // Invalid: uppercase or special characters
  assert.equal(tenantSlugSchema.safeParse('AcmeCorp').success, false);
  assert.equal(tenantSlugSchema.safeParse('acme_corp').success, false);
  assert.equal(tenantSlugSchema.safeParse('acme.corp').success, false);

  // Invalid: reserved slugs
  assert.equal(tenantSlugSchema.safeParse('admin').success, false);
  assert.equal(tenantSlugSchema.safeParse('api').success, false);
  assert.equal(tenantSlugSchema.safeParse('dashboard').success, false);
  assert.equal(isReservedSlug('admin'), true);
  assert.equal(isReservedSlug('regular-org'), false);
});

test('getEffectiveUrlMode computes correct canonical URLs and plan-based fallbacks', () => {
  const mockEnv = {
    APP_BASE_DOMAIN: 'example.com',
    APP_PROTOCOL: 'https',
    TENANCY_MODES: 'path,subdomain,customDomain',
  };

  const mockLimits = (urlAccess: { path: true; subdomain: boolean; customDomain: boolean }) => ({
    maxMembers: 10,
    maxStorageBytes: 1024,
    maxCustomRoles: 5,
    urlAccess,
  });

  // 1. FREE Plan: Always path-only fallback
  const freeTenant = { id: 't1', slug: 'free-org', status: 'ACTIVE' as const, urlStyle: 'subdomain' };
  const freeEntitlements = {
    limits: mockLimits({ path: true, subdomain: false, customDomain: false }),
    subscriptionStatus: 'ACTIVE',
  };
  const freeResult = getEffectiveUrlMode(freeTenant, null, freeEntitlements, mockEnv);
  assert.equal(freeResult.mode, 'path');
  assert.equal(freeResult.allowed.subdomain, false);
  assert.equal(freeResult.canonicalBase, 'https://example.com/w/free-org');
  assert.equal(freeResult.reason, 'PLAN');

  // 2. PRO Plan: Subdomain preferred & allowed
  const proTenant = { id: 't2', slug: 'pro-team', status: 'ACTIVE' as const, urlStyle: 'subdomain' };
  const proEntitlements = {
    limits: mockLimits({ path: true, subdomain: true, customDomain: false }),
    subscriptionStatus: 'ACTIVE',
  };
  const proResult = getEffectiveUrlMode(proTenant, null, proEntitlements, mockEnv);
  assert.equal(proResult.mode, 'subdomain');
  assert.equal(proResult.allowed.subdomain, true);
  assert.equal(proResult.canonicalBase, 'https://pro-team.example.com');
  assert.equal(proResult.reason, undefined);

  // 3. ENTERPRISE Plan with unverified custom domain -> falls back to subdomain
  const entTenant = { id: 't3', slug: 'big-corp', status: 'ACTIVE' as const, urlStyle: 'customDomain' };
  const entEntitlements = {
    limits: mockLimits({ path: true, subdomain: true, customDomain: true }),
    subscriptionStatus: 'ACTIVE',
  };
  const unverifiedBranding = {
    customDomain: 'portal.bigcorp.com',
    customDomainStatus: 'PENDING' as const,
  };
  const entUnverifiedResult = getEffectiveUrlMode(
    entTenant,
    unverifiedBranding,
    entEntitlements,
    mockEnv,
  );
  assert.equal(entUnverifiedResult.mode, 'subdomain');
  assert.equal(entUnverifiedResult.canonicalBase, 'https://big-corp.example.com');
  assert.equal(entUnverifiedResult.reason, 'UNVERIFIED');

  // 4. ENTERPRISE Plan with VERIFIED custom domain -> uses customDomain
  const verifiedBranding = {
    customDomain: 'portal.bigcorp.com',
    customDomainStatus: 'VERIFIED' as const,
  };
  const entVerifiedResult = getEffectiveUrlMode(
    entTenant,
    verifiedBranding,
    entEntitlements,
    mockEnv,
  );
  assert.equal(entVerifiedResult.mode, 'customDomain');
  assert.equal(entVerifiedResult.canonicalBase, 'https://portal.bigcorp.com');
  assert.equal(entVerifiedResult.reason, undefined);

  // 5. Suspended tenant loses non-path access / marks reason SUSPENDED
  const suspendedTenant = { id: 't4', slug: 'bad-actor', status: 'SUSPENDED' as const, urlStyle: 'path' };
  const suspendedResult = getEffectiveUrlMode(
    suspendedTenant,
    verifiedBranding,
    entEntitlements,
    mockEnv,
  );
  assert.equal(suspendedResult.mode, 'path');
  assert.equal(suspendedResult.reason, 'SUSPENDED');
});

test('Dynamic CORS origin validation allows verified domains and subdomains', async () => {
  // 1. Base domain and localhost
  assert.equal(await isOriginAllowed('http://localhost:3001'), true);

  // 2. Subdomains on APP_BASE_DOMAIN
  const baseDomain = env.APP_BASE_DOMAIN.split(':')[0] || 'localhost';
  assert.equal(await isOriginAllowed(`https://valid-team.${baseDomain}`), true);

  // 3. Reserved subdomains rejected
  assert.equal(await isOriginAllowed(`https://admin.${baseDomain}`), false);

  // 4. Dynamic custom domain verification lifecycle in Redis
  const testDomain = `test-portal-${Date.now()}.customer.org`;
  assert.equal(await isOriginAllowed(`https://${testDomain}`), false);

  await addCorsCustomDomain(testDomain);
  assert.equal(await isOriginAllowed(`https://${testDomain}`), true);

  await removeCorsCustomDomain(testDomain);
  assert.equal(await isOriginAllowed(`https://${testDomain}`), false);
});

test('URL settings API plan gating prevents unauthorized upgrades to subdomain/customDomain', async () => {
  const freeTenant = await tenantsRepo.createTenant({
    name: 'Free URL Test',
    slug: `free-url-${Date.now()}`,
    plan: 'FREE',
  });

  // FREE tenant attempting to set urlStyle to subdomain throws 403 PLAN_FEATURE_UNAVAILABLE
  await assert.rejects(
    async () => {
      await tenantsService.updateTenantUrlSettings(freeTenant.id, 'user-1', {
        urlStyle: 'subdomain',
      });
    },
    (err: any) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PLAN_FEATURE_UNAVAILABLE');
      assert.equal(err.details?.feature, 'urlAccess.subdomain');
      return true;
    },
  );

  // FREE tenant attempting to set customDomain throws 403 PLAN_FEATURE_UNAVAILABLE
  await assert.rejects(
    async () => {
      await tenantsService.updateTenantUrlSettings(freeTenant.id, 'user-1', {
        customDomain: 'portal.mycompany.com',
      });
    },
    (err: any) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PLAN_FEATURE_UNAVAILABLE');
      assert.equal(err.details?.feature, 'urlAccess.customDomain');
      return true;
    },
  );

  // Get URL settings returns instructions and canonical path
  const settings = await tenantsService.getTenantUrlSettings(freeTenant.id);
  assert.equal(settings.urlStyle, 'path');
  assert.equal(settings.effective, 'path');
  assert.equal(settings.allowed.subdomain, false);
  assert.equal(settings.allowed.customDomain, false);
  assert.ok(settings.instructions.cnameTarget);
});

test('resolvePublicTenant correctly identifies platform, allowed tenant, pathOnly fallback, and unknown host', async () => {
  const baseDomain = env.APP_BASE_DOMAIN.split(':')[0] || 'localhost';

  // 1. Platform resolution
  const platformRes = await tenantsService.resolvePublicTenant({ host: baseDomain });
  assert.equal(platformRes.kind, 'platform');
  assert.ok(platformRes.canonicalBase);

  // 2. Tenant with path-only fallback when on FREE plan
  const freeSlug = `free-gate-${Date.now()}`;
  await tenantsRepo.createTenant({
    name: 'Free Gate Tenant',
    slug: freeSlug,
    plan: 'FREE',
  });

  const subHost = `${freeSlug}.${baseDomain}`;
  const resolvedSub = await tenantsService.resolvePublicTenant({ host: subHost });
  assert.equal(resolvedSub.kind, 'tenant');
  assert.equal(resolvedSub.slug, freeSlug);
  assert.equal(resolvedSub.pathOnly, true);
  assert.ok(resolvedSub.canonicalBase?.includes(`/w/${freeSlug}`));

  // 3. Unknown host throws 404 TENANT_NOT_FOUND
  await assert.rejects(
    async () => {
      await tenantsService.resolvePublicTenant({ host: `nonexistent-${Date.now()}.random.com` });
    },
    (err: any) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'TENANT_NOT_FOUND');
      return true;
    },
  );
});
