import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authLimiter,
  billingPublicLimiter,
  handoffRedeemLimiter,
  internalLimiter,
  resolveLimiter,
  ssoLimiter,
} from '../../src/middleware/rate-limit';

test('Rate Limiters Matrix Integration Invariants', async (t) => {
  await t.test('All specialized limiters are configured as Express middleware functions', () => {
    assert.strictEqual(typeof ssoLimiter, 'function', 'ssoLimiter must be an express middleware');
    assert.strictEqual(
      typeof handoffRedeemLimiter,
      'function',
      'handoffRedeemLimiter must be an express middleware',
    );
    assert.strictEqual(
      typeof resolveLimiter,
      'function',
      'resolveLimiter must be an express middleware',
    );
    assert.strictEqual(
      typeof internalLimiter,
      'function',
      'internalLimiter must be an express middleware',
    );
    assert.strictEqual(
      typeof billingPublicLimiter,
      'function',
      'billingPublicLimiter must be an express middleware',
    );
    assert.strictEqual(
      typeof authLimiter,
      'function',
      'authLimiter must be an express middleware',
    );
  });
});
