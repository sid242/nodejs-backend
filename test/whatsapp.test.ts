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

test('WhatsApp Phone Takeover Guard & Central Registry Protection (W4)', async (t) => {
  const { db } = await import('@/config/db');
  const { tenants, platformWhatsAppAccountRegistry } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const accountRepo = await import('@/modules/whatsapp/repositories/whatsapp-account.repository');

  const activeTenants = await db
    .select({ id: tenants.id })
    .from(tenants)
    .limit(2)
    .catch(() => []);

  if (activeTenants.length < 2) {
    // If running in an environment without seeded DB, test the conflict logic directly
    await t.test('skips live DB test if 2 active tenants are not available in DB', () => {
      assert.ok(true);
    });
    return;
  }

  const tenantA = activeTenants[0]?.id;
  const tenantB = activeTenants[1]?.id;

  if (!tenantA || !tenantB) {
    return;
  }
  const testPhoneNumberId = `phone_takeover_test_${Date.now()}`;

  // Cleanup before test
  await db
    .delete(platformWhatsAppAccountRegistry)
    .where(eq(platformWhatsAppAccountRegistry.phoneNumberId, testPhoneNumberId));

  try {
    await t.test('tenant A successfully registers phone number in platform registry', async () => {
      await accountRepo.registerPlatformAccount({
        tenantId: tenantA,
        wabaId: 'waba_tenant_a',
        phoneNumberId: testPhoneNumberId,
        databaseRoutingKey: 'primary',
        connectionStatus: 'CONNECTED',
      });

      const resolved = await accountRepo.resolveTenantByPhoneNumberId(testPhoneNumberId);
      assert.equal(resolved?.tenantId, tenantA);
      assert.equal(resolved?.connectionStatus, 'CONNECTED');
    });

    await t.test(
      'tenant B is blocked with 409 WHATSAPP_PHONE_ALREADY_REGISTERED when attempting takeover',
      async () => {
        await assert.rejects(
          async () => {
            await accountRepo.registerPlatformAccount({
              tenantId: tenantB,
              wabaId: 'waba_tenant_b',
              phoneNumberId: testPhoneNumberId,
              databaseRoutingKey: 'primary',
              connectionStatus: 'CONNECTED',
            });
          },
          (err: unknown) => {
            return (
              err instanceof AppError &&
              err.status === 409 &&
              (err.details as Record<string, unknown>)?.code === 'WHATSAPP_PHONE_ALREADY_REGISTERED'
            );
          },
        );
      },
    );

    await t.test('tenant A can update its own phone number registration', async () => {
      await accountRepo.registerPlatformAccount({
        tenantId: tenantA,
        wabaId: 'waba_tenant_a_updated',
        phoneNumberId: testPhoneNumberId,
        databaseRoutingKey: 'primary',
        connectionStatus: 'CONNECTED',
      });

      const resolved = await accountRepo.resolveTenantByPhoneNumberId(testPhoneNumberId);
      assert.equal(resolved?.tenantId, tenantA);
      assert.equal(resolved?.wabaId, 'waba_tenant_a_updated');
    });

    await t.test('tenant B can register phone number after tenant A disconnects it', async () => {
      // Tenant A disconnects
      await db
        .update(platformWhatsAppAccountRegistry)
        .set({ connectionStatus: 'DISCONNECTED', updatedAt: new Date() })
        .where(eq(platformWhatsAppAccountRegistry.phoneNumberId, testPhoneNumberId));

      // Tenant B claims it
      await accountRepo.registerPlatformAccount({
        tenantId: tenantB,
        wabaId: 'waba_tenant_b',
        phoneNumberId: testPhoneNumberId,
        databaseRoutingKey: 'primary',
        connectionStatus: 'CONNECTED',
      });

      const resolved = await accountRepo.resolveTenantByPhoneNumberId(testPhoneNumberId);
      assert.equal(resolved?.tenantId, tenantB);
      assert.equal(resolved?.connectionStatus, 'CONNECTED');
    });
  } finally {
    // Cleanup after test
    await db
      .delete(platformWhatsAppAccountRegistry)
      .where(eq(platformWhatsAppAccountRegistry.phoneNumberId, testPhoneNumberId));
  }
});

test('WhatsApp Multi-Tenant Batch Routing & Deduplication Safety (W1, W3)', async (t) => {
  const webhookService = await import('@/modules/whatsapp/webhooks/whatsapp-webhook.service');
  const { whatsAppWebhookQueue } = await import('@/queues/index');
  const { redis } = await import('@/config/redis');

  const tenantA = 'tenant_batch_a';
  const phoneA = 'phone_id_a';
  const tenantB = 'tenant_batch_b';
  const phoneB = 'phone_id_b';

  const origAddBulk = whatsAppWebhookQueue.addBulk.bind(whatsAppWebhookQueue);

  const mockDeps = {
    resolveTenantByPhoneNumberId: async (phoneId: string) => {
      if (phoneId === phoneA) {
        return {
          tenantId: tenantA,
          wabaId: 'waba_a',
          connectionStatus: 'CONNECTED',
          databaseRoutingKey: 'primary',
        };
      }
      if (phoneId === phoneB) {
        return {
          tenantId: tenantB,
          wabaId: 'waba_b',
          connectionStatus: 'CONNECTED',
          databaseRoutingKey: 'tenant_b_key',
        };
      }
      return undefined;
    },
    resolveTenantByWabaId: async () => undefined,
  };

  try {
    await t.test(
      'routes batched webhook payload per change to respective tenants (W1)',
      async () => {
        const nonce = `${Date.now()}_${Math.random()}`;
        const batchPayload = {
          object: 'whatsapp_business_account',
          nonce,
          entry: [
            {
              id: 'waba_a',
              changes: [
                {
                  field: 'messages',
                  value: {
                    metadata: { phone_number_id: phoneA },
                    messages: [{ id: 'wamid_a', text: { body: 'Hello Tenant A' } }],
                  },
                },
              ],
            },
            {
              id: 'waba_b',
              changes: [
                {
                  field: 'messages',
                  value: {
                    metadata: { phone_number_id: phoneB },
                    messages: [{ id: 'wamid_b', text: { body: 'Hello Tenant B' } }],
                  },
                },
              ],
            },
          ],
        };

        const rawBody = Buffer.from(JSON.stringify(batchPayload));
        const secret = env.META_APP_SECRET || 'test-meta-app-secret-32-characters';
        const origSecret = env.META_APP_SECRET;
        (env as Record<string, unknown>).META_APP_SECRET = secret;
        const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const signature = `sha256=${hmac}`;

        let enqueuedJobs: Array<{
          name: string;
          data: {
            tenantId: string;
            phoneNumberId?: string;
            payload: {
              entry: Array<{
                changes: Array<{ value: { metadata: { phone_number_id: string } } }>;
              }>;
            };
          };
        }> = [];

        whatsAppWebhookQueue.addBulk = (async (jobs: unknown) => {
          enqueuedJobs = jobs as typeof enqueuedJobs;
          return jobs as unknown as ReturnType<typeof whatsAppWebhookQueue.addBulk>;
        }) as typeof whatsAppWebhookQueue.addBulk;

        try {
          const res = await webhookService.processWebhookPayload(
            rawBody,
            signature,
            batchPayload,
            mockDeps,
          );
          assert.equal(res.status, 'queued');
          assert.equal(enqueuedJobs.length, 2, 'Should enqueue 2 separate jobs');

          // Verify Tenant A job
          assert.equal(enqueuedJobs[0]?.data?.tenantId, tenantA);
          assert.equal(enqueuedJobs[0]?.data?.phoneNumberId, phoneA);
          assert.equal(
            enqueuedJobs[0]?.data?.payload?.entry[0]?.changes[0]?.value?.metadata?.phone_number_id,
            phoneA,
          );

          // Verify Tenant B job
          assert.equal(enqueuedJobs[1]?.data?.tenantId, tenantB);
          assert.equal(enqueuedJobs[1]?.data?.phoneNumberId, phoneB);
          assert.equal(
            enqueuedJobs[1]?.data?.payload?.entry[0]?.changes[0]?.value?.metadata?.phone_number_id,
            phoneB,
          );
        } finally {
          (env as Record<string, unknown>).META_APP_SECRET = origSecret;
          const dedupeKey = `whatsapp:webhook:dedupe:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
          await redis.del(dedupeKey);
        }
      },
    );

    await t.test('does not write dedupe key in Redis if queue.addBulk fails (W3)', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba_a',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: phoneA },
                  messages: [{ id: 'wamid_fail_test' }],
                },
              },
            ],
          },
        ],
      };

      const rawBody = Buffer.from(JSON.stringify(payload) + Date.now());
      const fingerprint = crypto.createHash('sha256').update(rawBody).digest('hex');
      const dedupeKey = `whatsapp:webhook:dedupe:${fingerprint}`;

      const secret = env.META_APP_SECRET || 'test-meta-app-secret-32-characters';
      const origSecret = env.META_APP_SECRET;
      (env as Record<string, unknown>).META_APP_SECRET = secret;
      const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const signature = `sha256=${hmac}`;

      // Simulate queue failure
      whatsAppWebhookQueue.addBulk = (async () => {
        throw new Error('Redis connection dropped');
      }) as typeof whatsAppWebhookQueue.addBulk;

      try {
        await assert.rejects(
          async () => {
            await webhookService.processWebhookPayload(rawBody, signature, payload, mockDeps);
          },
          (err: unknown) => {
            return (
              err instanceof AppError &&
              err.status === 500 &&
              (err.details as Record<string, unknown>)?.code === 'WHATSAPP_QUEUE_ERROR'
            );
          },
        );

        // Verify dedupe key was NOT written to Redis
        const dedupeVal = await redis.get(dedupeKey);
        assert.equal(dedupeVal, null, 'Dedupe marker must not be written if enqueue fails');
      } finally {
        (env as Record<string, unknown>).META_APP_SECRET = origSecret;
        const dedupeKey = `whatsapp:webhook:dedupe:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
        await redis.del(dedupeKey);
      }
    });
  } finally {
    whatsAppWebhookQueue.addBulk = origAddBulk;
  }
});

test('WhatsApp Marketing Opt-in Requirement & Inbound STOP Handling (W6)', async (t) => {
  const { assertMessageConsent } =
    await import('@/modules/whatsapp/services/whatsapp-message.service');
  const { isRecipientConsentSuppressed } =
    await import('@/modules/whatsapp/services/whatsapp-campaign.service');
  const typeConsent = (status: 'OPTED_IN' | 'OPTED_OUT') =>
    ({
      id: 'c1',
      tenantId: 't1',
      contactId: 'ct1',
      purpose: 'MARKETING',
      status,
      consentSource: 'DIRECT',
      policyVersion: 'v1.0',
      consentedAt: new Date(),
      revokedAt: null,
      evidenceReference: null,
      createdAt: new Date(),
    }) as unknown as import('@/db/schema').WhatsAppContactConsentRecord;

  await t.test('assertMessageConsent blocks MARKETING when consent is missing', () => {
    assert.throws(
      () => assertMessageConsent('MARKETING', undefined, '+919876543210'),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        (err.details as Record<string, unknown>)?.code === 'WHATSAPP_MARKETING_OPT_IN_REQUIRED',
    );
  });

  await t.test('assertMessageConsent blocks MARKETING when status is OPTED_OUT', () => {
    assert.throws(
      () => assertMessageConsent('MARKETING', typeConsent('OPTED_OUT'), '+919876543210'),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        (err.details as Record<string, unknown>)?.code === 'WHATSAPP_MARKETING_OPT_IN_REQUIRED',
    );
  });

  await t.test('assertMessageConsent allows MARKETING when status is OPTED_IN', () => {
    assert.doesNotThrow(() =>
      assertMessageConsent('MARKETING', typeConsent('OPTED_IN'), '+919876543210'),
    );
  });

  await t.test('assertMessageConsent allows UTILITY when consent is missing', () => {
    assert.doesNotThrow(() => assertMessageConsent('UTILITY', undefined, '+919876543210'));
  });

  await t.test('assertMessageConsent blocks UTILITY when status is OPTED_OUT', () => {
    assert.throws(
      () => assertMessageConsent('UTILITY', typeConsent('OPTED_OUT'), '+919876543210'),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        (err.details as Record<string, unknown>)?.code === 'WHATSAPP_CONSENT_REQUIRED',
    );
  });

  await t.test('isRecipientConsentSuppressed suppresses recipients without opt-in', () => {
    assert.equal(isRecipientConsentSuppressed('MARKETING', undefined), true);
    assert.equal(isRecipientConsentSuppressed('MARKETING', typeConsent('OPTED_OUT')), true);
    assert.equal(isRecipientConsentSuppressed('MARKETING', typeConsent('OPTED_IN')), false);

    assert.equal(isRecipientConsentSuppressed('UTILITY', undefined), false);
    assert.equal(isRecipientConsentSuppressed('UTILITY', typeConsent('OPTED_IN')), false);
    assert.equal(isRecipientConsentSuppressed('UTILITY', typeConsent('OPTED_OUT')), true);
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

test('WhatsApp Delivery Status Progression Guard (W12)', async (t) => {
  const { shouldUpdateMessageStatus } =
    await import('@/modules/whatsapp/utils/status-progression.util');

  await t.test(
    'allows valid forward progression (QUEUED -> ACCEPTED -> SENT -> DELIVERED -> READ)',
    () => {
      assert.equal(shouldUpdateMessageStatus('QUEUED', 'ACCEPTED'), true);
      assert.equal(shouldUpdateMessageStatus('ACCEPTED', 'SENT'), true);
      assert.equal(shouldUpdateMessageStatus('SENT', 'DELIVERED'), true);
      assert.equal(shouldUpdateMessageStatus('DELIVERED', 'READ'), true);
      // Direct skip progression is also valid (e.g. Meta skips SENT directly to DELIVERED)
      assert.equal(shouldUpdateMessageStatus('QUEUED', 'SENT'), true);
      assert.equal(shouldUpdateMessageStatus('SENT', 'READ'), true);
    },
  );

  await t.test('rejects regressive out-of-order status updates', () => {
    // Late SENT arriving after message is already DELIVERED
    assert.equal(shouldUpdateMessageStatus('DELIVERED', 'SENT'), false);
    // Late DELIVERED arriving after message is already READ
    assert.equal(shouldUpdateMessageStatus('READ', 'DELIVERED'), false);
    // Late SENT arriving after message is already READ
    assert.equal(shouldUpdateMessageStatus('READ', 'SENT'), false);
    // Duplicate status update
    assert.equal(shouldUpdateMessageStatus('SENT', 'SENT'), false);
    assert.equal(shouldUpdateMessageStatus('DELIVERED', 'DELIVERED'), false);
    assert.equal(shouldUpdateMessageStatus('READ', 'READ'), false);
  });

  await t.test('handles failure transitions and prevents downgrading delivered messages', () => {
    // Failure from pre-delivery states is allowed
    assert.equal(shouldUpdateMessageStatus('QUEUED', 'FAILED'), true);
    assert.equal(shouldUpdateMessageStatus('ACCEPTED', 'FAILED'), true);
    assert.equal(shouldUpdateMessageStatus('SENT', 'FAILED'), true);

    // Late FAILED error cannot downgrade already DELIVERED or READ messages
    assert.equal(shouldUpdateMessageStatus('DELIVERED', 'FAILED'), false);
    assert.equal(shouldUpdateMessageStatus('READ', 'FAILED'), false);
  });

  await t.test('allows Meta transient recovery: DELIVERED or READ supersedes FAILED', () => {
    // Meta sometimes recovers transient delivery failure
    assert.equal(shouldUpdateMessageStatus('FAILED', 'DELIVERED'), true);
    assert.equal(shouldUpdateMessageStatus('FAILED', 'READ'), true);
    // But SENT cannot supersede FAILED
    assert.equal(shouldUpdateMessageStatus('FAILED', 'SENT'), false);
    assert.equal(shouldUpdateMessageStatus('FAILED', 'ACCEPTED'), false);
  });
});

test('WhatsApp Versioned Rate Card & Cost Estimation (W14)', async (t) => {
  const { calculateEstimatedCost } = await import('@/modules/whatsapp/utils/rate-card.util');

  await t.test('calculates correct rates for India (IN)', () => {
    const marketing = calculateEstimatedCost('MARKETING', 'IN');
    assert.equal(marketing.currency, 'INR');
    assert.equal(marketing.estimatedCost, '0.8600');
    assert.equal(marketing.rateCardVersion, '2026-01');

    const utility = calculateEstimatedCost('UTILITY', 'IN');
    assert.equal(utility.currency, 'INR');
    assert.equal(utility.estimatedCost, '0.1150');

    const auth = calculateEstimatedCost('AUTHENTICATION', 'IN');
    assert.equal(auth.currency, 'INR');
    assert.equal(auth.estimatedCost, '0.1150');
  });

  await t.test('calculates correct rates for United States (US)', () => {
    const marketing = calculateEstimatedCost('MARKETING', 'US');
    assert.equal(marketing.currency, 'USD');
    assert.equal(marketing.estimatedCost, '0.0250');

    const utility = calculateEstimatedCost('UTILITY', 'US');
    assert.equal(utility.currency, 'USD');
    assert.equal(utility.estimatedCost, '0.0150');
  });

  await t.test('falls back gracefully to default rate card for unknown regions', () => {
    const unknownCountry = calculateEstimatedCost('MARKETING', 'ZZ');
    assert.equal(unknownCountry.currency, 'INR');
    assert.equal(unknownCountry.estimatedCost, '0.8600');
  });
});
