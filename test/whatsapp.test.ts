import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import {
  getCountryFromPhoneNumber,
  normalizePhoneNumber,
} from '@/modules/whatsapp/utils/phone-number.util';
import {
  resolveTemplateVariables,
  validateTemplateParameters,
} from '@/modules/whatsapp/utils/template-variables.util';
import { verifyMetaSignature } from '@/modules/whatsapp/webhooks/whatsapp-signature.service';
import { verifySubscription } from '@/modules/whatsapp/webhooks/whatsapp-webhook.service';

test('WhatsApp Phone Number Normalization', async (t) => {
  await t.test('normalizes international numbers with dashes and spaces', () => {
    assert.equal(normalizePhoneNumber('+91 98765-43210'), '+919876543210');
    assert.equal(normalizePhoneNumber('+1 (555) 123-4567'), '+15551234567');
    assert.equal(normalizePhoneNumber('+44 20 7946 0958'), '+442079460958');
  });

  await t.test('prepends default country code if missing 10 digits', () => {
    assert.equal(normalizePhoneNumber('9876543210', '91'), '+919876543210');
  });

  await t.test('rejects invalid or too short phone numbers', () => {
    assert.throws(
      () => normalizePhoneNumber('123'),
      (err: unknown) => {
        return err instanceof AppError && err.status === 400;
      },
    );
    assert.throws(
      () => normalizePhoneNumber('abc-def-ghij'),
      (err: unknown) => {
        return err instanceof AppError && err.status === 400;
      },
    );
  });

  await t.test('identifies recipient country correctly', () => {
    assert.equal(getCountryFromPhoneNumber('+919876543210'), 'IN');
    assert.equal(getCountryFromPhoneNumber('+15551234567'), 'US');
    assert.equal(getCountryFromPhoneNumber('+442079460958'), 'GB');
    assert.equal(getCountryFromPhoneNumber('+971501234567'), 'AE');
  });
});

test('WhatsApp Template Variables Substitution & Validation', async (t) => {
  await t.test('substitutes positional variables {{1}}, {{2}}', () => {
    const result = resolveTemplateVariables({
      templateText: 'Hello {{1}}, your booking for {{2}} is confirmed for {{3}}.',
      variableMap: {
        '1': 'Rahul',
        '2': 'Skyline Villa',
        '3': 'Tomorrow 10 AM',
      },
    });

    assert.equal(
      result.rendered,
      'Hello Rahul, your booking for Skyline Villa is confirmed for Tomorrow 10 AM.',
    );
    assert.equal(result.missingVariables.length, 0);
  });

  await t.test('detects missing variables in template substitution', () => {
    const result = resolveTemplateVariables({
      templateText: 'Hello {{1}}, your code is {{2}}.',
      variableMap: {
        '1': 'Aman',
      },
    });

    assert.equal(result.missingVariables.includes('2'), true);
  });

  await t.test('validates template parameters count against placeholder requirements', () => {
    assert.doesNotThrow(() => {
      validateTemplateParameters('Visit {{1}} at {{2}}', [
        { type: 'text', text: 'Site A' },
        { type: 'text', text: '5 PM' },
      ]);
    });

    assert.throws(
      () => {
        validateTemplateParameters('Visit {{1}} at {{2}} with {{3}}', [
          { type: 'text', text: 'Site A' },
        ]);
      },
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
  });
});

test('WhatsApp Webhook Handshake & Signature Security', async (t) => {
  await t.test('verifies valid GET subscription challenge', () => {
    const challenge = '1158201444';
    const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN;

    const res = verifySubscription('subscribe', verifyToken, challenge);
    assert.equal(res, challenge);
  });

  await t.test('rejects invalid subscription token', () => {
    assert.throws(
      () => {
        verifySubscription('subscribe', 'wrong-token', '12345');
      },
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
  });

  await t.test('validates authentic HMAC-SHA256 signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const secret = env.META_APP_SECRET || 'test-meta-app-secret-32-characters';

    // Set temporary test secret if not set
    const origSecret = env.META_APP_SECRET;
    (env as unknown as Record<string, unknown>).META_APP_SECRET = secret;

    try {
      const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const signatureHeader = `sha256=${hmac}`;

      assert.equal(verifyMetaSignature(signatureHeader, rawBody), true);
      assert.equal(verifyMetaSignature('sha256=invalidhash', rawBody), false);
      assert.equal(verifyMetaSignature(undefined, rawBody), false);
    } finally {
      (env as unknown as Record<string, unknown>).META_APP_SECRET = origSecret;
    }
  });
});

test('WhatsApp OTP Authentication Flow', async (t) => {
  const testPhone = `+9199${Math.floor(10000000 + Math.random() * 90000000)}`;

  await t.test('sends OTP challenge and stores secure hash', async () => {
    const res = await import('@/modules/whatsapp/services/whatsapp-otp.service').then((m) =>
      m.sendOtp({ phoneNumber: testPhone, purpose: 'LOGIN' }),
    );

    assert.equal(res.success, true);
    assert.equal(res.expiresInSeconds, 300);
  });

  await t.test('rejects incorrect verification code', async () => {
    const otpService = await import('@/modules/whatsapp/services/whatsapp-otp.service');
    await assert.rejects(
      async () => {
        await otpService.verifyOtp({
          phoneNumber: testPhone,
          purpose: 'LOGIN',
          code: '000000',
        });
      },
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        ((err.details as Record<string, unknown>)?.code === 'WHATSAPP_OTP_INVALID' ||
          err.code === 'BAD_REQUEST'),
    );
  });
});

test('WhatsApp Graph API Version Expiry & Token Exchange (W8)', async (t) => {
  const { checkGraphApiVersionExpiry } =
    await import('@/modules/whatsapp/utils/graph-version.util');
  const { MetaCloudApiProvider } =
    await import('@/modules/whatsapp/providers/meta-cloud-api.provider');

  await t.test('detects expired Graph API version', () => {
    // Reference date after v19.0 expiry (2026-05-14)
    const refDate = new Date('2026-06-01T00:00:00Z');
    const result = checkGraphApiVersionExpiry('v19.0', refDate);
    assert.equal(result.isExpired, true);
    assert.ok(result.warning?.includes('expired on'));
  });

  await t.test('detects Graph API version within 90 days of expiry', () => {
    // Reference date 30 days before v21.0 expiry (2027-01-21) -> ~2026-12-22
    const refDate = new Date('2026-12-22T00:00:00Z');
    const result = checkGraphApiVersionExpiry('v21.0', refDate);
    assert.equal(result.isExpired, false);
    assert.ok(result.daysRemaining !== null && result.daysRemaining <= 90);
    assert.ok(result.warning?.includes('will expire on'));
  });

  await t.test('approves stable current Graph API version (v26.0)', () => {
    const refDate = new Date('2026-11-26T00:00:00Z');
    const result = checkGraphApiVersionExpiry('v26.0', refDate);
    assert.equal(result.isExpired, false);
    assert.ok(result.daysRemaining !== null && result.daysRemaining > 90);
    assert.equal(result.warning, undefined);
  });

  await t.test('MetaCloudApiProvider defaults to v26.0', () => {
    const provider = new MetaCloudApiProvider();
    assert.equal(env.META_GRAPH_API_VERSION, 'v26.0');
    assert.ok(provider);
  });

  await t.test('exchangeCodeForToken sends credentials in POST body, not query', async () => {
    const provider = new MetaCloudApiProvider();
    const origAppId = env.META_APP_ID;
    const origAppSecret = env.META_APP_SECRET;

    (env as unknown as Record<string, unknown>).META_APP_ID = 'test-meta-app-id';
    (env as unknown as Record<string, unknown>).META_APP_SECRET = 'test-meta-app-secret';

    const origFetch = global.fetch;
    let interceptedUrl: string | undefined;
    let interceptedMethod: string | undefined;
    let interceptedBody: string | undefined;

    try {
      global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        interceptedUrl = String(input);
        interceptedMethod = init?.method;
        interceptedBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token-from-code',
            token_type: 'bearer',
            expires_in: 5184000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await provider.exchangeCodeForToken('meta-test-auth-code');
      assert.equal(result.accessToken, 'mock-access-token-from-code');
      assert.equal(result.tokenType, 'bearer');
      assert.equal(interceptedMethod, 'POST');
      assert.ok(interceptedUrl?.endsWith('/oauth/access_token'));
      // Verify query string does NOT leak secrets
      assert.ok(!interceptedUrl?.includes('client_secret'));
      assert.ok(!interceptedUrl?.includes('code='));
      // Verify body contains the secrets
      const parsedBody = JSON.parse(interceptedBody ?? '{}');
      assert.equal(parsedBody.client_id, 'test-meta-app-id');
      assert.equal(parsedBody.client_secret, 'test-meta-app-secret');
      assert.equal(parsedBody.code, 'meta-test-auth-code');
    } finally {
      global.fetch = origFetch;
      (env as unknown as Record<string, unknown>).META_APP_ID = origAppId;
      (env as unknown as Record<string, unknown>).META_APP_SECRET = origAppSecret;
    }
  });
});
