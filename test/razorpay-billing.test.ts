import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import * as billingDto from '../src/modules/billing/billing.dto';
import { processBillingWebhook } from '../src/modules/billing/billing.service';
import { getBillingProvider, manualBillingProvider } from '../src/modules/billing/provider';
import {
  parseAndVerifyRazorpayWebhook,
  RazorpayBillingProvider,
  verifyOrderPaymentSignature,
  verifySubscriptionPaymentSignature,
  verifyWebhookSignature,
} from '../src/modules/billing/providers/razorpay';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

// Setup mock secrets in environment for testing
const TEST_SECRET = 'test_razorpay_secret_key_12345';
const TEST_WEBHOOK_SECRET = 'test_webhook_secret_key_67890';
(env as any).RAZORPAY_KEY_SECRET = TEST_SECRET;
(env as any).RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

test('verifyOrderPaymentSignature validates genuine HMAC-SHA256 signatures and rejects invalid ones', () => {
  const orderId = 'order_test_123';
  const paymentId = 'pay_test_456';
  const expectedPayload = `${orderId}|${paymentId}`;
  const validSignature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(expectedPayload)
    .digest('hex');

  // Genuine signature
  const isValid = verifyOrderPaymentSignature({
    orderId,
    paymentId,
    signature: validSignature,
  });
  assert.equal(isValid, true);

  // Tampered payment ID
  const isTampered = verifyOrderPaymentSignature({
    orderId,
    paymentId: 'pay_tampered_999',
    signature: validSignature,
  });
  assert.equal(isTampered, false);

  // Tampered signature
  const isInvalidSig = verifyOrderPaymentSignature({
    orderId,
    paymentId,
    signature: 'bad_signature_abc123',
  });
  assert.equal(isInvalidSig, false);
});

test('verifySubscriptionPaymentSignature validates genuine subscription HMAC-SHA256 signatures', () => {
  const subscriptionId = 'sub_test_789';
  const paymentId = 'pay_test_012';
  const expectedPayload = `${paymentId}|${subscriptionId}`;
  const validSignature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(expectedPayload)
    .digest('hex');

  const isValid = verifySubscriptionPaymentSignature({
    paymentId,
    subscriptionId,
    signature: validSignature,
  });
  assert.equal(isValid, true);

  const isInvalid = verifySubscriptionPaymentSignature({
    paymentId,
    subscriptionId: 'sub_tampered_000',
    signature: validSignature,
  });
  assert.equal(isInvalid, false);
});

test('verifyWebhookSignature validates raw-body bytes against webhook secret with timing-safe comparison', () => {
  const payloadObject = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_abc',
          amount: 500000,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
    created_at: 1712000000,
  };

  const rawBodyBuffer = Buffer.from(JSON.stringify(payloadObject), 'utf8');
  const validWebhookSig = crypto
    .createHmac('sha256', TEST_WEBHOOK_SECRET)
    .update(rawBodyBuffer)
    .digest('hex');

  // Valid raw buffer
  const validBufferResult = verifyWebhookSignature(rawBodyBuffer, validWebhookSig);
  assert.equal(validBufferResult, true);

  // Valid string
  const validStringResult = verifyWebhookSignature(JSON.stringify(payloadObject), validWebhookSig);
  assert.equal(validStringResult, true);

  // Tampered payload
  const tamperedBuffer = Buffer.from(
    JSON.stringify({ ...payloadObject, event: 'payment.failed' }),
    'utf8',
  );
  const invalidResult = verifyWebhookSignature(tamperedBuffer, validWebhookSig);
  assert.equal(invalidResult, false);

  // Invalid signature length/value
  assert.equal(verifyWebhookSignature(rawBodyBuffer, 'invalid_sig'), false);
});

test('parseAndVerifyRazorpayWebhook parses headers and raw body safely', () => {
  const body = {
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: 'pay_123',
          order_id: 'order_123',
          amount: 50000,
          currency: 'INR',
          status: 'captured',
          notes: {
            tenantId: '00000000-0000-0000-0000-000000000001',
            planKey: 'PRO',
          },
        },
      },
    },
    created_at: 1712000000,
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
  assert.equal(event.event, 'payment.captured');
  assert.equal(result.eventType, 'payment.captured');
  assert.equal(result.tenantId, '00000000-0000-0000-0000-000000000001');
  assert.equal(result.status, 'captured');
});

test('getBillingProvider returns correct singleton provider instances', () => {
  const manual = getBillingProvider('manual');
  assert.equal(manual.name, 'manual');
  assert.equal(manual, manualBillingProvider);

  const razorpay = getBillingProvider('razorpay');
  assert.equal(razorpay.name, 'razorpay');
  assert.ok(razorpay instanceof RazorpayBillingProvider);

  assert.throws(() => {
    getBillingProvider('unknown_provider');
  });
});

test('checkoutOrderDto validates valid plan keys and intervals', () => {
  const validMonthly = billingDto.checkoutOrderDto.safeParse({
    planKey: 'pro',
    billingInterval: 'MONTHLY',
  });
  assert.ok(validMonthly.success);
  assert.equal(validMonthly.data?.planKey, 'PRO');

  const validAnnual = billingDto.checkoutOrderDto.safeParse({
    planKey: 'ENTERPRISE',
    billingInterval: 'ANNUAL',
  });
  assert.ok(validAnnual.success);

  const invalid = billingDto.checkoutOrderDto.safeParse({
    planKey: '',
  });
  assert.equal(invalid.success, false);
});

test('verifyOrderPaymentDto requires all 3 Razorpay verification fields', () => {
  const valid = billingDto.verifyOrderPaymentDto.safeParse({
    razorpay_order_id: 'order_123',
    razorpay_payment_id: 'pay_456',
    razorpay_signature: 'sig_789',
  });
  assert.ok(valid.success);

  const missingSig = billingDto.verifyOrderPaymentDto.safeParse({
    razorpay_order_id: 'order_123',
    razorpay_payment_id: 'pay_456',
  });
  assert.equal(missingSig.success, false);
});

test('issueRefundDto validates positive refund minor amount and mandatory reason', () => {
  const valid = billingDto.issueRefundDto.safeParse({
    amountMinor: 150000,
    reason: 'Customer requested plan downgrade',
  });
  assert.ok(valid.success);

  const missingReason = billingDto.issueRefundDto.safeParse({
    amountMinor: 1000,
    reason: '',
  });
  assert.equal(missingReason.success, false);

  const negativeAmount = billingDto.issueRefundDto.safeParse({
    amountMinor: -50,
    reason: 'Invalid amount',
  });
  assert.equal(negativeAmount.success, false);
});

test('processBillingWebhook handles event idempotency and duplicate deduplication', async () => {
  const eventId = `test_event_${Date.now()}`;
  const webhookDto: billingDto.BillingWebhookDto = {
    provider: 'razorpay',
    eventId,
    eventType: 'payment.captured',
    payload: {
      test: true,
      amount: 1000,
    },
  };

  // First execution: processed
  const first = await processBillingWebhook(webhookDto);
  assert.equal(first.status, 'PROCESSED');
  assert.equal(first.idempotent, false);

  // Second execution with same provider and eventId: duplicate ignored
  const second = await processBillingWebhook(webhookDto);
  assert.equal(second.status, 'DUPLICATE_IGNORED');
  assert.equal(second.idempotent, true);
  assert.equal(second.eventId, eventId);
});
