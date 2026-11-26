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

test('WhatsApp Template Status Webhook, Security & Clean Disconnect (W2, W9, W13)', async (t) => {
  const webhookService = await import('@/modules/whatsapp/webhooks/whatsapp-webhook.service');
  const signatureService = await import('@/modules/whatsapp/webhooks/whatsapp-signature.service');
  const { whatsAppWebhookQueue } = await import('@/queues/index');
  const { redis } = await import('@/config/redis');

  const tenantId = 'tenant_w2_w9_w13';
  const testWabaId = 'waba_test_w2';

  const origAddBulk = whatsAppWebhookQueue.addBulk.bind(whatsAppWebhookQueue);

  await t.test(
    'W2: routes template status update without phone_number_id via WABA lookup',
    async () => {
      const templateUpdatePayload = {
        object: 'whatsapp_business_account',
        nonce: `${Date.now()}_w2`,
        entry: [
          {
            id: testWabaId,
            changes: [
              {
                field: 'message_template_status_update',
                value: {
                  event: 'APPROVED',
                  message_template_id: 'meta_template_99',
                  message_template_name: 'appointment_confirmation',
                  message_template_language: 'en_US',
                },
              },
            ],
          },
        ],
      };

      const rawBody = Buffer.from(JSON.stringify(templateUpdatePayload));
      const secret = env.META_APP_SECRET || 'test-meta-app-secret-32-characters';
      const origSecret = env.META_APP_SECRET;
      (env as Record<string, unknown>).META_APP_SECRET = secret;
      const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const signature = `sha256=${hmac}`;

      let enqueuedJobs: Array<{ data: { tenantId: string; wabaId: string } }> = [];
      whatsAppWebhookQueue.addBulk = (async (jobs: unknown) => {
        enqueuedJobs = jobs as typeof enqueuedJobs;
        return jobs as unknown as ReturnType<typeof whatsAppWebhookQueue.addBulk>;
      }) as typeof whatsAppWebhookQueue.addBulk;

      const mockDeps = {
        resolveTenantByPhoneNumberId: async () => undefined,
        resolveTenantByWabaId: async (wId: string) => {
          if (wId === testWabaId) {
            return {
              tenantId,
              wabaId: testWabaId,
              connectionStatus: 'CONNECTED',
              databaseRoutingKey: 'primary',
            };
          }
          return undefined;
        },
      };

      try {
        const res = await webhookService.processWebhookPayload(
          rawBody,
          signature,
          templateUpdatePayload,
          mockDeps,
        );
        assert.equal(res.status, 'queued');
        assert.equal(enqueuedJobs.length, 1);
        assert.equal(enqueuedJobs[0]?.data?.tenantId, tenantId);
        assert.equal(enqueuedJobs[0]?.data?.wabaId, testWabaId);
      } finally {
        (env as Record<string, unknown>).META_APP_SECRET = origSecret;
        const dedupeKey = `whatsapp:webhook:dedupe:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
        await redis.del(dedupeKey);
      }
    },
  );

  await t.test('W13: ignores webhook events when account is DISCONNECTED', async () => {
    const disconnectedPayload = {
      object: 'whatsapp_business_account',
      nonce: `${Date.now()}_w13`,
      entry: [
        {
          id: testWabaId,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone_disconnected' },
                messages: [{ id: 'wamid_disconnected' }],
              },
            },
          ],
        },
      ],
    };

    const rawBody = Buffer.from(JSON.stringify(disconnectedPayload));
    const secret = env.META_APP_SECRET || 'test-meta-app-secret-32-characters';
    const origSecret = env.META_APP_SECRET;
    (env as Record<string, unknown>).META_APP_SECRET = secret;
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const signature = `sha256=${hmac}`;

    let enqueuedCount = 0;
    whatsAppWebhookQueue.addBulk = (async (jobs: unknown) => {
      enqueuedCount = (jobs as unknown[]).length;
      return jobs as unknown as ReturnType<typeof whatsAppWebhookQueue.addBulk>;
    }) as typeof whatsAppWebhookQueue.addBulk;

    const mockDeps = {
      resolveTenantByPhoneNumberId: async () => ({
        tenantId,
        wabaId: testWabaId,
        connectionStatus: 'DISCONNECTED',
        databaseRoutingKey: 'primary',
      }),
      resolveTenantByWabaId: async () => undefined,
    };

    try {
      const res = await webhookService.processWebhookPayload(
        rawBody,
        signature,
        disconnectedPayload,
        mockDeps,
      );
      assert.equal(res.status, 'acknowledged');
      assert.equal(enqueuedCount, 0, 'No jobs must be enqueued for disconnected tenant');
    } finally {
      (env as Record<string, unknown>).META_APP_SECRET = origSecret;
    }
  });

  await t.test('W9: verifySubscription rejects default token in production', () => {
    const origNodeEnv = env.NODE_ENV;
    const origToken = env.META_WEBHOOK_VERIFY_TOKEN;
    (env as Record<string, unknown>).NODE_ENV = 'production';
    (env as Record<string, unknown>).META_WEBHOOK_VERIFY_TOKEN = 'whatsapp-verify-token';

    try {
      assert.throws(
        () => webhookService.verifySubscription('subscribe', 'whatsapp-verify-token', '12345'),
        (err: unknown) => err instanceof AppError && err.status === 500,
      );
    } finally {
      (env as Record<string, unknown>).NODE_ENV = origNodeEnv;
      (env as Record<string, unknown>).META_WEBHOOK_VERIFY_TOKEN = origToken;
    }
  });

  await t.test('W9: verifyMetaSignature rejects when secret is missing in staging/prod', () => {
    const origNodeEnv = env.NODE_ENV;
    const origSecret = env.META_APP_SECRET;
    (env as Record<string, unknown>).NODE_ENV = 'staging';
    (env as Record<string, unknown>).META_APP_SECRET = undefined;

    try {
      const verified = signatureService.verifyMetaSignature('sha256=abcdef', Buffer.from('test'));
      assert.equal(verified, false);
    } finally {
      (env as Record<string, unknown>).NODE_ENV = origNodeEnv;
      (env as Record<string, unknown>).META_APP_SECRET = origSecret;
    }
  });

  whatsAppWebhookQueue.addBulk = origAddBulk;
});
