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
    assert.strictEqual(typeof authLimiter, 'function', 'authLimiter must be an express middleware');
  });

  await t.test('Auth limiters fail closed on store error to protect against brute force attacks', async () => {
    const { redis } = await import('../../src/config/redis');
    const origCall = (redis as any).call;
    try {
      (redis as any).call = () => Promise.reject(new Error('Redis store failure'));

      const req = { ip: '127.0.0.1', headers: {}, app: { get: () => false } } as any;
      const res = { setHeader: () => {} } as any;

      await new Promise<void>((resolve) => {
        authLimiter(req, res, (err) => {
          assert.ok(err, 'authLimiter must call next with error when store fails (fail closed)');
          assert.equal(err?.message, 'Redis store failure');
          resolve();
        });
      });

      await new Promise<void>((resolve) => {
        ssoLimiter(req, res, (err) => {
          assert.ok(err, 'ssoLimiter must call next with error when store fails (fail closed)');
          assert.equal(err?.message, 'Redis store failure');
          resolve();
        });
      });

      await new Promise<void>((resolve) => {
        handoffRedeemLimiter(req, res, (err) => {
          assert.ok(err, 'handoffRedeemLimiter must call next with error when store fails (fail closed)');
          assert.equal(err?.message, 'Redis store failure');
          resolve();
        });
      });
    } finally {
      (redis as any).call = origCall;
    }
  });

  await t.test('General limiters fail open on store error to preserve availability', async () => {
    const { redis } = await import('../../src/config/redis');
    const origCall = (redis as any).call;
    try {
      (redis as any).call = () => Promise.reject(new Error('Redis store failure'));

      const req = { ip: '127.0.0.1', headers: {}, app: { get: () => false } } as any;
      const res = { setHeader: () => {} } as any;

      await new Promise<void>((resolve) => {
        billingPublicLimiter(req, res, (err) => {
          assert.equal(err, undefined, 'billingPublicLimiter must call next without error when store fails (fail open)');
          resolve();
        });
      });
    } finally {
      (redis as any).call = origCall;
    }
  });
});
