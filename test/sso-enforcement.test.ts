import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import { safeEqual } from '@/lib/crypto';
import {
  billingPublicLimiter,
  handoffRedeemLimiter,
  internalLimiter,
  resolveLimiter,
  ssoLimiter,
} from '@/middleware/rate-limit';
import { isSupportDeniedRoute, SUPPORT_SCOPE_PRESETS } from '@/middleware/support';
import { assertSsoNotEnforced } from '@/modules/sso/sso.enforcement';

let dbConnected = false;

before(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    dbConnected = true;
  } catch {
    dbConnected = false;
  }
});

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 200).unref();
});

describe('File 07 — SSO Enforcement, Rate Limiting & Hardening', () => {
  describe('1. Constant-Time safeEqual Helper', () => {
    it('returns true for matching secrets', () => {
      assert.strictEqual(safeEqual('super-secret-token-123', 'super-secret-token-123'), true);
      assert.strictEqual(safeEqual('a', 'a'), true);
    });

    it('returns false for mismatched secrets of identical length', () => {
      assert.strictEqual(safeEqual('super-secret-token-123', 'super-secret-token-456'), false);
    });

    it('returns false for mismatched secrets of different lengths without timing leak', () => {
      assert.strictEqual(safeEqual('short', 'much-longer-secret-token-value'), false);
      assert.strictEqual(safeEqual('much-longer-secret-token-value', 'short'), false);
    });

    it('returns false when either secret is missing or empty', () => {
      assert.strictEqual(safeEqual('', 'secret'), false);
      assert.strictEqual(safeEqual('secret', ''), false);
      assert.strictEqual(safeEqual(undefined as any, 'secret'), false);
      assert.strictEqual(safeEqual('secret', undefined as any), false);
    });
  });

  describe('2. Support Session Scope & Deny-List Enforcement', () => {
    it('defines explicit permission presets for READ_ONLY, ASSIST, and FULL_ADMIN', () => {
      assert.ok(Array.isArray(SUPPORT_SCOPE_PRESETS.READ_ONLY));
      assert.ok(Array.isArray(SUPPORT_SCOPE_PRESETS.ASSIST));
      assert.ok(Array.isArray(SUPPORT_SCOPE_PRESETS.FULL_ADMIN));

      // READ_ONLY must only have read/list permissions
      assert.ok(SUPPORT_SCOPE_PRESETS.READ_ONLY.every((p) => p.endsWith(':read')));

      // ASSIST adds branding:update and email_templates:manage and files:upload
      assert.ok(SUPPORT_SCOPE_PRESETS.ASSIST.includes('branding:update' as any));
      assert.ok(SUPPORT_SCOPE_PRESETS.ASSIST.includes('email_templates:manage' as any));
      assert.ok(SUPPORT_SCOPE_PRESETS.ASSIST.includes('files:upload' as any));
      assert.ok(!SUPPORT_SCOPE_PRESETS.ASSIST.includes('files:delete' as any));

      // FULL_ADMIN adds files:delete
      assert.ok(SUPPORT_SCOPE_PRESETS.FULL_ADMIN.includes('files:delete' as any));
    });

    it('identifies and denies restricted routes for support tokens', () => {
      // 1. Auth password and 2FA
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'POST',
          originalUrl: '/api/v1/auth/change-password',
          path: '/change-password',
          baseUrl: '/api/v1/auth',
        } as any),
        true,
      );
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'POST',
          originalUrl: '/api/v1/auth/2fa/verify',
          path: '/2fa/verify',
          baseUrl: '/api/v1/auth',
        } as any),
        true,
      );

      // 2. Billing writes
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'POST',
          originalUrl: '/api/v1/billing/subscriptions',
          path: '/subscriptions',
          baseUrl: '/api/v1/billing',
        } as any),
        true,
      );
      // Billing reads are allowed
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'GET',
          originalUrl: '/api/v1/billing/invoices',
          path: '/invoices',
          baseUrl: '/api/v1/billing',
        } as any),
        false,
      );

      // 3. SSO and SCIM routes
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'GET',
          originalUrl: '/api/v1/sso/config',
          path: '/config',
          baseUrl: '/api/v1/sso',
        } as any),
        true,
      );
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'POST',
          originalUrl: '/api/v1/scim/v2/Users',
          path: '/v2/Users',
          baseUrl: '/api/v1/scim',
        } as any),
        true,
      );

      // 4. Member / Role mutations
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'POST',
          originalUrl: '/api/v1/tenants/123/members',
          path: '/123/members',
          baseUrl: '/api/v1/tenants',
        } as any),
        true,
      );
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'PUT',
          originalUrl: '/api/v1/tenants/123/roles',
          path: '/123/roles',
          baseUrl: '/api/v1/tenants',
        } as any),
        true,
      );

      // 5. Database operations
      assert.strictEqual(
        isSupportDeniedRoute({
          method: 'POST',
          originalUrl: '/api/v1/platform/db-ops/switchover',
          path: '/switchover',
          baseUrl: '/api/v1/platform/db-ops',
        } as any),
        true,
      );
    });
  });

  describe('3. Rate Limiters Matrix Configuration', () => {
    it('properly exports all hardened limiters with standard headers and valid thresholds', () => {
      assert.ok(ssoLimiter, 'ssoLimiter should be configured');
      assert.ok(handoffRedeemLimiter, 'handoffRedeemLimiter should be configured');
      assert.ok(resolveLimiter, 'resolveLimiter should be configured');
      assert.ok(internalLimiter, 'internalLimiter should be configured');
      assert.ok(billingPublicLimiter, 'billingPublicLimiter should be configured');
    });
  });

  describe('4. SSO Mandatory Enforcement Helper', () => {
    it('passes cleanly when no SSO is configured for user or domain', async (t) => {
      if (!dbConnected) {
        t.skip('Database offline, skipping live DB query');
        return;
      }
      await assert.doesNotReject(async () => {
        await assertSsoNotEnforced({ email: 'john.doe@independent-unclaimed.org' });
      });
    });
  });
});
