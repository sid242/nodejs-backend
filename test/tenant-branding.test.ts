import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { randomUUID } from 'node:crypto';
import { closeDb, db } from '@/config/db.js';
import { closeRedisClients } from '@/config/redis.js';
import { users } from '@/db/schema/index.js';
import {
  requestBrandingUploadUrlDto,
  resolvePublicTenantDto,
  updateTenantBrandingDto,
  verifyCustomDomainDto,
} from '@/modules/tenants/tenants.dto.js';
import { tenantBrandingRepo } from '@/modules/tenants/tenant-branding.repository.js';
import { tenantsRepo } from '@/modules/tenants/tenants.repository.js';
import * as tenantsService from '@/modules/tenants/tenants.service.js';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('resolvePublicTenantDto validates slug or domain query parameters', () => {
  const bySlug = resolvePublicTenantDto.safeParse({ slug: 'acme-corp' });
  assert.equal(bySlug.success, true);
  if (bySlug.success) {
    assert.equal(bySlug.data.slug, 'acme-corp');
  }

  const byDomain = resolvePublicTenantDto.safeParse({ domain: 'portal.acme.com' });
  assert.equal(byDomain.success, true);
  if (byDomain.success) {
    assert.equal(byDomain.data.domain, 'portal.acme.com');
  }
});

test('updateTenantBrandingDto validates hex colors and domain formats', () => {
  const valid = {
    companyName: 'Acme Global',
    primaryColor: '#4F46E5',
    accentColor: '#06B6D4',
    borderRadius: '0.75rem',
    customDomain: 'app.acmeglobal.com',
    supportEmail: 'help@acmeglobal.com',
  };

  const parsed = updateTenantBrandingDto.safeParse(valid);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.primaryColor, '#4F46E5');
    assert.equal(parsed.data.customDomain, 'app.acmeglobal.com');
  }

  // Invalid hex color should fail
  const invalidColor = updateTenantBrandingDto.safeParse({ primaryColor: 'not-a-color' });
  assert.equal(invalidColor.success, false);

  // Invalid domain format should fail
  const invalidDomain = updateTenantBrandingDto.safeParse({ customDomain: 'invalid domain name' });
  assert.equal(invalidDomain.success, false);
});

test('requestBrandingUploadUrlDto enforces allowed image MIME types and categories', () => {
  const validLogo = {
    type: 'logo',
    filename: 'company-logo.png',
    contentType: 'image/png',
  };
  const parsed = requestBrandingUploadUrlDto.safeParse(validLogo);
  assert.equal(parsed.success, true);

  // Reject non-image or executable content types
  const invalidType = {
    type: 'logo',
    filename: 'script.js',
    contentType: 'application/javascript',
  };
  const rejected = requestBrandingUploadUrlDto.safeParse(invalidType);
  assert.equal(rejected.success, false);
});

test('verifyCustomDomainDto validates bypass flag', () => {
  const valid = verifyCustomDomainDto.safeParse({ bypassVerification: true });
  assert.equal(valid.success, true);
  const empty = verifyCustomDomainDto.safeParse({});
  assert.equal(empty.success, true);
});

test('verifyTenantCustomDomain enforces configured domain and transitions status to ACTIVE', async () => {
  const tenant = await tenantsRepo.createTenant({
    name: 'Domain Test Corp',
    slug: `domain-test-${Date.now()}`,
    plan: 'PRO',
  });

  const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
  const testUserId = existingUser?.id ?? randomUUID();

  // Case 1: Throws error when no custom domain configured
  await assert.rejects(
    async () => {
      await tenantsService.verifyTenantCustomDomain(tenant.id, testUserId, true);
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('No custom domain configured'));
      return true;
    },
  );

  // Set custom domain with initial status PENDING
  const testDomain = `custom-${Date.now()}.example.com`;
  await tenantBrandingRepo.upsertTenantBranding({
    tenantId: tenant.id,
    companyName: 'Domain Test Corp',
    customDomain: testDomain,
    customDomainStatus: 'PENDING',
  });

  // Verify initial status is PENDING
  const initialBranding = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
  assert.equal(initialBranding?.customDomainStatus, 'PENDING');

  // Case 2: Verification with non-existent live DNS record fails with 400
  await assert.rejects(
    async () => {
      await tenantsService.verifyTenantCustomDomain(tenant.id, testUserId, false);
    },
    (err: any) => {
      assert.equal(err.status, 400);
      assert.ok(err.message.includes('resolve DNS TXT record') || err.message.includes('did not match'));
      return true;
    },
  );

  // Case 3: Successful verification updates customDomainStatus to ACTIVE
  const verified = await tenantsService.verifyTenantCustomDomain(tenant.id, testUserId, true);
  assert.equal(verified.customDomainStatus, 'ACTIVE');

  // Verify database record has updated to ACTIVE
  const refreshed = await tenantBrandingRepo.findBrandingByTenantId(tenant.id);
  assert.equal(refreshed?.customDomainStatus, 'ACTIVE');
});

