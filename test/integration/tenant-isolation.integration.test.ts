import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertTenantScope, currentTenantCtx, runWithTenantDb } from '../../src/db/tenancy/context';

test('Tenant Context & Database Isolation Integration Invariants', async (t) => {
  await t.test(
    'assertTenantScope safely permits execution outside tenant scope (platform context)',
    () => {
      assert.doesNotThrow(() => {
        assertTenantScope('00000000-0000-0000-0000-000000000001');
      });
    },
  );

  await t.test(
    'assertTenantScope throws AppError.forbidden when tenant IDs mismatch within tenant context',
    async () => {
      const tenantA = '00000000-0000-0000-0000-000000000001';
      const tenantB = '00000000-0000-0000-0000-000000000002';

      await runWithTenantDb({ tenantId: tenantA, db: null as any }, async () => {
        // Correct scope passes
        assert.doesNotThrow(() => {
          assertTenantScope(tenantA);
        });

        // Mismatched scope throws 403 FORBIDDEN
        let thrown = false;
        try {
          assertTenantScope(tenantB);
        } catch (err: any) {
          thrown = true;
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
        }
        assert.strictEqual(thrown, true, 'Must throw error on cross-tenant access violation');
      });
    },
  );

  await t.test('currentTenantCtx is restored after asynchronous context completes', async () => {
    const tenantId = '00000000-0000-0000-0000-000000000001';

    assert.strictEqual(
      currentTenantCtx(),
      undefined,
      'Context must be undefined before runWithTenantDb',
    );

    await runWithTenantDb({ tenantId, db: null as any }, async () => {
      assert.strictEqual(
        currentTenantCtx()?.tenantId,
        tenantId,
        'Context must match during execution',
      );
    });

    assert.strictEqual(
      currentTenantCtx(),
      undefined,
      'Context must be cleared after runWithTenantDb',
    );
  });
});
