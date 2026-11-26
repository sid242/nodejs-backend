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

test('WhatsApp Onboarding Session & Token Validation (W7)', async (t) => {
  const onboardingService = await import('@/modules/whatsapp/services/whatsapp-onboarding.service');
  const { metaWhatsAppProvider } =
    await import('@/modules/whatsapp/providers/meta-cloud-api.provider');

  const testTenantId = 'tenant_w7_test_01';
  const testUserId = 'user_w7_test_01';

  await t.test('creates onboarding session with valid single-use nonce', async () => {
    const session = await onboardingService.createOnboardingSession(testTenantId, testUserId);
    assert.ok(session.state, 'Session state nonce should be present');
    assert.equal(typeof session.state, 'string');
    assert.ok(session.state.length >= 32, 'Nonce should be cryptographically random hex');
  });

  await t.test('rejects completeOnboarding when state nonce is missing or invalid', async () => {
    await assert.rejects(
      async () => {
        await onboardingService.completeOnboarding(testTenantId, testUserId, {
          state: 'invalid-or-unregistered-nonce',
          wabaId: 'waba_123',
          accessToken: 'test_token',
        });
      },
      (err: unknown) => {
        return (
          err instanceof AppError &&
          err.status === 400 &&
          (err.details as Record<string, unknown>)?.code === 'WHATSAPP_INVALID_ONBOARDING_STATE'
        );
      },
    );
  });

  await t.test('rejects completeOnboarding when tenant does not match session tenant', async () => {
    const session = await onboardingService.createOnboardingSession(testTenantId, testUserId);
    await assert.rejects(
      async () => {
        await onboardingService.completeOnboarding('different_tenant_99', testUserId, {
          state: session.state,
          wabaId: 'waba_123',
          accessToken: 'test_token',
        });
      },
      (err: unknown) => {
        return err instanceof AppError && err.status === 403;
      },
    );
  });

  await t.test('rejects completeOnboarding when debugToken marks token invalid', async () => {
    const session = await onboardingService.createOnboardingSession(testTenantId, testUserId);
    const origDebug = metaWhatsAppProvider.debugToken.bind(metaWhatsAppProvider);
    // Mock debugToken to simulate invalid token
    metaWhatsAppProvider.debugToken = async () => ({
      appId: 'mock_app',
      isValid: false,
      scopes: [],
    });

    try {
      await assert.rejects(
        async () => {
          await onboardingService.completeOnboarding(testTenantId, testUserId, {
            state: session.state,
            wabaId: 'waba_123',
            accessToken: 'invalid_token',
          });
        },
        (err: unknown) => {
          return (
            err instanceof AppError &&
            err.status === 400 &&
            (err.details as Record<string, unknown>)?.code === 'WHATSAPP_INVALID_TOKEN'
          );
        },
      );
    } finally {
      metaWhatsAppProvider.debugToken = origDebug;
    }
  });

  await t.test('metaWhatsAppProvider.debugToken returns token debug info', async () => {
    const res = await metaWhatsAppProvider.debugToken('sample_token');
    assert.equal(typeof res.isValid, 'boolean');
    assert.ok(Array.isArray(res.scopes));
  });
});

test('WhatsApp Socket Privacy & Room Authorization (W5)', async (t) => {
  const { authorizeRoomAccess } = await import('@/sockets/handlers/room.handlers');

  const tenantId = 'tenant_w5_privacy';
  const permittedUserId = 'user_w5_permitted';
  const unpermittedUserId = 'user_w5_unpermitted';

  const mockDeps = {
    findTenantMember: async (tId: string, uId: string) => {
      if (tId === tenantId && (uId === permittedUserId || uId === unpermittedUserId)) {
        return {
          id: `m_${uId}`,
          status: 'ACTIVE',
          userId: uId,
          tenantId: tId,
        } as unknown as Awaited<
          ReturnType<typeof import('@/modules/tenants/tenants.repository').findTenantMember>
        >;
      }
      return null;
    },
    resolveUserPermissions: async (_tId: string, uId: string) => {
      if (uId === permittedUserId) {
        return {
          roles: ['MEMBER'],
          roleIds: ['r1'],
          permissions: ['whatsapp:conversation:read'],
          groupIds: [],
          groupSlugs: [],
        };
      }
      return {
        roles: ['MEMBER'],
        roleIds: ['r2'],
        permissions: ['other:permission'],
        groupIds: [],
        groupSlugs: [],
      };
    },
  };

  await t.test(
    'allows member with whatsapp:conversation:read to join tenant:<id>:whatsapp',
    async () => {
      const socket = {
        data: {
          actorType: 'USER',
          user: { id: permittedUserId },
          workspaceTenantId: tenantId,
        },
      } as unknown as import('socket.io').Socket;

      const allowed = await authorizeRoomAccess(socket, `tenant:${tenantId}:whatsapp`, mockDeps);
      assert.equal(allowed, true);
    },
  );

  await t.test(
    'rejects member without whatsapp:conversation:read from joining tenant:<id>:whatsapp',
    async () => {
      const socket = {
        data: {
          actorType: 'USER',
          user: { id: unpermittedUserId },
          workspaceTenantId: tenantId,
        },
      } as unknown as import('socket.io').Socket;

      const allowed = await authorizeRoomAccess(socket, `tenant:${tenantId}:whatsapp`, mockDeps);
      assert.equal(allowed, false);
    },
  );

  await t.test(
    'rejects socket from joining tenant:<id>:whatsapp when workspace tenant mismatch',
    async () => {
      const socket = {
        data: {
          actorType: 'USER',
          user: { id: permittedUserId },
          workspaceTenantId: 'another_tenant_456',
        },
      } as unknown as import('socket.io').Socket;

      const allowed = await authorizeRoomAccess(socket, `tenant:${tenantId}:whatsapp`, mockDeps);
      assert.equal(allowed, false);
    },
  );
});
