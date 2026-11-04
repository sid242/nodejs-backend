import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';

import { closeDb, db } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import { users } from '@/db/schema/index';
import { isOriginAllowed } from '@/lib/cors';
import * as billingRepo from '@/modules/billing/billing.repository';
import { tenantBrandingRepo } from '@/modules/tenants/tenant-branding.repository';
import {
  requestBrandingUploadUrlDto,
  updateTenantBrandingDto,
} from '@/modules/tenants/tenants.dto';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';
import * as tenantsService from '@/modules/tenants/tenants.service';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

describe('Phase 08: Workspace Branding, White-Labeling & Custom Domains Unit Tests', () => {
  let staffUserId: string;

  it('0. Preparation: resolve actor user', async () => {
    const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
    staffUserId = existingUser?.id ?? randomUUID();
    assert.ok(staffUserId);
  });

  describe('1. Brand Identity Customization & Validation', () => {
    it('validates hex colors, fonts, and border radius correctly in DTO', () => {
      const valid = updateTenantBrandingDto.safeParse({
        companyName: 'Acme Enterprise',
        primaryColor: '#7C3AED',
        accentColor: '#06B6D4',
        secondaryColor: '#E0E7FF',
        primaryDarkColor: '#8B5CF6',
        fontFamily: 'Plus Jakarta Sans',
        borderRadius: '0.75rem',
        sidebarTheme: 'BRAND',
      });
      assert.equal(valid.success, true);
      if (valid.success) {
        assert.equal(valid.data.primaryColor, '#7C3AED');
        assert.equal(valid.data.fontFamily, 'Plus Jakarta Sans');
        assert.equal(valid.data.sidebarTheme, 'BRAND');
      }

      // Rejects invalid hex color
      const invalidHex = updateTenantBrandingDto.safeParse({
        primaryColor: 'red',
      });
      assert.equal(invalidHex.success, false);

      // Rejects unsupported font family
      const invalidFont = updateTenantBrandingDto.safeParse({
        fontFamily: 'Comic Sans MS' as any,
      });
      assert.equal(invalidFont.success, false);
    });

    it('enforces allowed image MIME types for asset upload presigned URLs', () => {
      const validMimes = [
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'image/x-icon',
      ];
      for (const ct of validMimes) {
        const parsed = requestBrandingUploadUrlDto.safeParse({
          type: 'logo',
          filename: 'brand-logo.png',
          contentType: ct,
        });
        assert.equal(parsed.success, true, `MIME ${ct} should be allowed`);
      }

      // Rejects non-image files (e.g. scripts or executables)
      const invalid = requestBrandingUploadUrlDto.safeParse({
        type: 'logo',
        filename: 'malicious.js',
        contentType: 'application/javascript',
      });
      assert.equal(invalid.success, false);
    });
  });

  describe('2. White-Labeling & Watermark Removal Entitlement Gating', () => {
    it('throws 403 when FREE workspace attempts to remove platform watermark', async () => {
      const freeTenant = await tenantsRepo.createTenant({
        name: `Free Watermark Test ${Date.now()}`,
        slug: `free-wm-${Date.now()}`,
        plan: 'FREE',
      });

      await assert.rejects(
        async () => {
          await tenantsService.updateTenantBranding(freeTenant.id, staffUserId, {
            hideWatermark: true,
          });
        },
        (err: any) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'PLAN_FEATURE_UNAVAILABLE');
          assert.equal(err.details?.feature, 'branding.remove_watermark');
          return true;
        },
      );
    });

    it('allows PRO and ENTERPRISE workspaces to remove platform watermark', async () => {
      const proTenant = await tenantsRepo.createTenant({
        name: `Pro Watermark Test ${Date.now()}`,
        slug: `pro-wm-${Date.now()}`,
        plan: 'PRO',
      });

      // Assign override or grant entitlement to PRO tenant
      await billingRepo.setTenantEntitlementOverride({
        tenantId: proTenant.id,
        entitlementKey: 'branding.remove_watermark',
        value: true,
      });

      const updated = await tenantsService.updateTenantBranding(proTenant.id, staffUserId, {
        hideWatermark: true,
        companyName: 'Whitelabeled Pro Portal',
      });

      assert.equal(updated.hideWatermark, true);
      assert.equal(updated.companyName, 'Whitelabeled Pro Portal');

      // Verify database reflects hideWatermark
      const dbBranding = await tenantBrandingRepo.findBrandingByTenantId(proTenant.id);
      assert.equal(dbBranding?.hideWatermark, true);
    });
  });

  describe('3. Custom Theme Colors & Palette Entitlement Gating', () => {
    it('throws 403 when FREE workspace attempts non-default custom brand palette', async () => {
      const freeTenant = await tenantsRepo.createTenant({
        name: `Free Palette Test ${Date.now()}`,
        slug: `free-palette-${Date.now()}`,
        plan: 'FREE',
      });

      await assert.rejects(
        async () => {
          await tenantsService.updateTenantBranding(freeTenant.id, staffUserId, {
            primaryColor: '#E11D48', // Non-default color
          });
        },
        (err: any) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'PLAN_FEATURE_UNAVAILABLE');
          assert.equal(err.details?.feature, 'branding.custom_colors');
          return true;
        },
      );
    });

    it('permits custom palette updates when workspace has custom_colors entitlement', async () => {
      const enterpriseTenant = await tenantsRepo.createTenant({
        name: `Ent Palette Test ${Date.now()}`,
        slug: `ent-palette-${Date.now()}`,
        plan: 'ENTERPRISE',
      });

      // Grant custom_colors entitlement override
      await billingRepo.setTenantEntitlementOverride({
        tenantId: enterpriseTenant.id,
        entitlementKey: 'branding.custom_colors',
        value: true,
      });

      const updated = await tenantsService.updateTenantBranding(enterpriseTenant.id, staffUserId, {
        primaryColor: '#059669',
        accentColor: '#10B981',
        primaryDarkColor: '#34D399',
        fontFamily: 'Outfit',
        borderRadius: '0.75rem',
      });

      assert.equal(updated.primaryColor, '#059669');
      assert.equal(updated.accentColor, '#10B981');
      assert.equal(updated.primaryDarkColor, '#34D399');
      assert.equal(updated.fontFamily, 'Outfit');
      assert.equal(updated.borderRadius, '0.75rem');
    });
  });

  describe('4. Custom Domain Setup, DNS Verification & CORS Lifecycle', () => {
    it('throws 403 when FREE workspace attempts to configure a custom domain', async () => {
      const freeTenant = await tenantsRepo.createTenant({
        name: `Free Domain Gate ${Date.now()}`,
        slug: `free-dom-${Date.now()}`,
        plan: 'FREE',
      });

      await assert.rejects(
        async () => {
          await tenantsService.updateTenantUrlSettings(freeTenant.id, staffUserId, {
            customDomain: 'portal.mycompany.org',
          });
        },
        (err: any) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'PLAN_FEATURE_UNAVAILABLE');
          assert.equal(err.details?.feature, 'urlAccess.customDomain');
          return true;
        },
      );
    });

    it('rejects registering a custom domain ending with base platform domain', async () => {
      const entTenant = await tenantsRepo.createTenant({
        name: `Domain Reserved Test ${Date.now()}`,
        slug: `dom-res-${Date.now()}`,
        plan: 'ENTERPRISE',
      });

      await assert.rejects(
        async () => {
          await tenantsService.updateTenantUrlSettings(entTenant.id, staffUserId, {
            customDomain: 'subdomain.localhost',
          });
        },
        (err: any) => {
          assert.equal(err.status, 400);
          assert.equal(err.code, 'DOMAIN_RESERVED');
          return true;
        },
      );
    });

    it('registers custom domain with PENDING status, generates TXT instructions, and handles verification', async () => {
      const entTenant = await tenantsRepo.createTenant({
        name: `Domain Verification Test ${Date.now()}`,
        slug: `dom-verify-${Date.now()}`,
        plan: 'ENTERPRISE',
      });

      const customDomain = `portal-${Date.now()}.customcorp.com`;

      // 1. Configure custom domain
      const settings = await tenantsService.updateTenantUrlSettings(entTenant.id, staffUserId, {
        customDomain,
      });

      assert.equal(settings.customDomain, customDomain);
      assert.equal(settings.status, 'PENDING');
      assert.ok(settings.instructions.txtRecord?.includes(`saas-verify=${entTenant.id}`));
      assert.ok(settings.instructions.cnameTarget);

      // CORS not yet allowed before verification
      assert.equal(await isOriginAllowed(`https://${customDomain}`), false);

      // 2. Failed verification on non-existent DNS record
      await assert.rejects(
        async () => {
          await tenantsService.verifyTenantCustomDomain(entTenant.id, staffUserId, false);
        },
        (err: any) => {
          assert.equal(err.status, 400);
          assert.equal(err.code, 'DOMAIN_NOT_VERIFIED');
          return true;
        },
      );

      // Status transitioned to FAILED
      const failedBranding = await tenantBrandingRepo.findBrandingByTenantId(entTenant.id);
      assert.equal(failedBranding?.customDomainStatus, 'FAILED');

      // 3. Staff bypass allows immediate verification & CORS registration
      const verified = await tenantsService.verifyTenantCustomDomain(entTenant.id, staffUserId, true);
      assert.equal(verified.customDomainStatus, 'VERIFIED');
      assert.ok(verified.customDomainVerifiedAt);

      // CORS now allowed for the verified domain
      assert.equal(await isOriginAllowed(`https://${customDomain}`), true);

      // 4. Removing custom domain clears CORS and resets status
      await tenantsService.updateTenantUrlSettings(entTenant.id, staffUserId, {
        customDomain: null,
      });
      assert.equal(await isOriginAllowed(`https://${customDomain}`), false);
    });
  });

  describe('5. Public Tenant Resolution & Redis Cache Invariants', () => {
    it('resolves public tenant by custom domain with branding and hideWatermark state', async () => {
      const entTenant = await tenantsRepo.createTenant({
        name: `Resolver Test ${Date.now()}`,
        slug: `res-test-${Date.now()}`,
        plan: 'ENTERPRISE',
      });

      const domain = `app-${Date.now()}.resolvercorp.com`;

      await tenantBrandingRepo.upsertTenantBranding({
        tenantId: entTenant.id,
        companyName: 'Resolver Corp Global',
        primaryColor: '#2563EB',
        hideWatermark: true,
        customDomain: domain,
        customDomainStatus: 'VERIFIED',
      });

      // Update tenant urlStyle to customDomain
      await tenantsRepo.updateTenantUrlStyle(entTenant.id, 'customDomain');

      const resolved = await tenantsService.resolvePublicTenant({ host: domain });
      assert.equal(resolved.kind, 'tenant');
      assert.equal(resolved.tenantId, entTenant.id);
      assert.equal(resolved.branding?.companyName, 'Resolver Corp Global');
      assert.equal(resolved.branding?.primaryColor, '#2563EB');
      assert.equal(resolved.branding?.hideWatermark, true);
    });
  });
});
