import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import { AppError } from '../src/lib/errors';
import { handleBillingWebhook } from '../src/modules/billing/billing.controller';
import {
  parseAndVerifyRazorpayWebhook,
  verifyWebhookSignature,
} from '../src/modules/billing/providers/razorpay';

const TEST_WEBHOOK_SECRET = 'test_webhook_secret_key_step01_secure';
(env as any).RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Step 01 - verifyWebhookSignature requires Buffer and rejects string without raw bytes', () => {
  const payload = { event: 'payment.captured', created_at: 1700000000 };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const validSig = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

  // Valid Buffer
  assert.equal(verifyWebhookSignature(rawBody, validSig), true);

  // Tampered payload
  const tampered = Buffer.from(JSON.stringify({ ...payload, tampered: true }), 'utf8');
  assert.equal(verifyWebhookSignature(tampered, validSig), false);

  // Mismatched signature length
  assert.equal(verifyWebhookSignature(rawBody, 'short_sig'), false);
});

test('Step 01 - parseAndVerifyRazorpayWebhook rejects missing signature with 401', () => {
  const mockReq: any = {
    headers: {},
    rawBody: Buffer.from('{}'),
    body: {},
  };

  assert.throws(
    () => {
      parseAndVerifyRazorpayWebhook(mockReq);
    },
    (err: any) => err instanceof AppError && err.status === 401,
  );
});

test('Step 01 - parseAndVerifyRazorpayWebhook rejects missing rawBody Buffer with 400', () => {
  const mockReq: any = {
    headers: { 'x-razorpay-signature': 'some_signature' },
    rawBody: null,
    body: {},
  };

  assert.throws(
    () => {
      parseAndVerifyRazorpayWebhook(mockReq);
    },
    (err: any) => err instanceof AppError && err.status === 400,
  );
});

test('Step 01 - parseAndVerifyRazorpayWebhook rejects invalid signature with 401', () => {
  const rawBody = Buffer.from(JSON.stringify({ event: 'order.paid' }), 'utf8');
  const mockReq: any = {
    headers: { 'x-razorpay-signature': 'invalid_signature_hex_length_64_characters_xxxxxxxxxxxxxxxxxxxx' },
    rawBody,
    body: { event: 'order.paid' },
  };

  assert.throws(
    () => {
      parseAndVerifyRazorpayWebhook(mockReq);
    },
    (err: any) => err instanceof AppError && err.status === 401,
  );
});

test('Step 01 - parseAndVerifyRazorpayWebhook succeeds with genuine rawBody and signature', () => {
  const body = {
    event: 'order.paid',
    payload: {
      order: {
        entity: {
          id: 'order_123',
          amount: 50000,
          status: 'paid',
          notes: { tenantId: 'tenant_abc' },
        },
      },
    },
    created_at: 1700000000,
  };
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  const signature = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

  const mockReq: any = {
    headers: {
      'x-razorpay-signature': signature,
    },
    rawBody,
    body,
  };

  const { event, result } = parseAndVerifyRazorpayWebhook(mockReq);
  assert.equal(event.event, 'order.paid');
  assert.equal(result.eventType, 'order.paid');
  assert.equal(result.tenantId, 'tenant_abc');
});

test('Step 01 - handleBillingWebhook rejects request without signature with 401 Unauthorized', async () => {
  const mockReq: any = {
    headers: {},
    body: {
      provider: 'stripe',
      eventType: 'subscription.updated',
      payload: { tenantId: 'evil_tenant', planKey: 'ENTERPRISE' },
    },
  };
  const mockRes: any = {
    status: () => mockRes,
    json: () => mockRes,
  };

  const err: any = await new Promise((resolve) => {
    handleBillingWebhook(mockReq, mockRes, (e: any) => resolve(e));
  });

  assert.ok(err instanceof AppError);
  assert.equal(err.status, 401);
  assert.equal(err.message, 'Missing webhook signature');
});

test('Step 01 - handleBillingWebhook rejects request without x-razorpay-event-id with 400 Bad Request', async () => {
  const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }), 'utf8');
  const signature = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

  const mockReq: any = {
    headers: {
      'x-razorpay-signature': signature,
      // Missing x-razorpay-event-id
    },
    rawBody,
    body: { event: 'payment.captured' },
  };
  const mockRes: any = {
    status: () => mockRes,
    json: () => mockRes,
  };

  const err: any = await new Promise((resolve) => {
    handleBillingWebhook(mockReq, mockRes, (e: any) => resolve(e));
  });

  assert.ok(err instanceof AppError);
  assert.equal(err.status, 400);
  assert.equal(err.message, 'Missing x-razorpay-event-id header');
});

test('Step 01 - handleBillingWebhook rejects payload exceeding 256kb with 400 Bad Request', async () => {
  const oversizedBuffer = Buffer.alloc(257 * 1024, 'a');
  const signature = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(oversizedBuffer).digest('hex');

  const mockReq: any = {
    headers: {
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': 'evt_oversized_123',
    },
    rawBody: oversizedBuffer,
    body: {},
  };
  const mockRes: any = {
    status: () => mockRes,
    json: () => mockRes,
  };

  const err: any = await new Promise((resolve) => {
    handleBillingWebhook(mockReq, mockRes, (e: any) => resolve(e));
  });

  assert.ok(err instanceof AppError);
  assert.equal(err.status, 400);
  assert.equal(err.message, 'Webhook payload exceeds 256kb limit');
});
