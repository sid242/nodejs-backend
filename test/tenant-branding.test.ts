import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePublicTenantDto,
  updateTenantBrandingDto,
  requestBrandingUploadUrlDto,
} from '@/modules/tenants/tenants.dto.js';
import { closeRedisClients } from '@/config/redis.js';
import { closeDb } from '@/config/db.js';

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
