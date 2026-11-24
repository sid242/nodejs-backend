import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSupportDeniedRoute } from '../../src/middleware/support';

test('Support Session Scope & Route Denial Integration Invariants', async (t) => {
  await t.test('Permanently blocked routes are denied regardless of scope', () => {
    // Password modification
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'POST', originalUrl: '/api/v1/auth/password' } as any),
      true,
      '/auth/password must be denied to support sessions',
    );
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'POST', originalUrl: '/api/v1/auth/reset-password' } as any),
      true,
      '/auth/reset-password must be denied to support sessions',
    );

    // Billing writes
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'POST', originalUrl: '/api/v1/billing/invoices' } as any),
      true,
      'Billing POST mutations must be denied to support sessions',
    );
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'GET', originalUrl: '/api/v1/billing/invoices' } as any),
      false,
      'Billing GET queries are allowed to support sessions',
    );

    // SSO and SCIM mutations & configuration
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'POST', originalUrl: '/api/v1/tenants/t1/sso' } as any),
      true,
      'SSO routes must be denied to support sessions',
    );
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'GET', originalUrl: '/api/v1/tenants/t1/scim/tokens' } as any),
      true,
      'SCIM routes must be denied to support sessions',
    );

    // Database operations
    assert.strictEqual(
      isSupportDeniedRoute({
        method: 'POST',
        originalUrl: '/api/v1/platform/tenants/t1/db/switchover',
      } as any),
      true,
      'DB operations must be denied to support sessions',
    );
  });

  await t.test('Allowed operational paths pass through for assistance', () => {
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'GET', originalUrl: '/api/v1/users/profile' } as any),
      false,
      'GET /users/profile must be allowed',
    );
    assert.strictEqual(
      isSupportDeniedRoute({ method: 'GET', originalUrl: '/api/v1/files' } as any),
      false,
      'GET /files must be allowed',
    );
  });
});
