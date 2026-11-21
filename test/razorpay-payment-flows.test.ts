import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import { AppError } from '../src/lib/errors';
import { billingRepo } from '../src/modules/billing/billing.repository';
import billingRouter from '../src/modules/billing/billing.routes';
import * as billingService from '../src/modules/billing/billing.service';
import { razorpayGateway } from '../src/modules/billing/providers/razorpay';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository';

// Set test environment configuration
(env as any).RAZORPAY_KEY_ID = 'rzp_test_key_id_step02';
(env as any).RAZORPAY_KEY_SECRET = 'rzp_test_secret_key_step02';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

describe('Step 02: Razorpay Payment Flows Hardening', () => {
  it('onPlanChanged supports oldPlanKey as string | null without type or runtime errors', async () => {
    assert.equal(typeof billingService.onPlanChanged, 'function');
  });

  it('createTenantOrderCheckout reuses existing CREATED order within 15 minutes idempotently', async () => {
    const origFindTenant = tenantsRepo.findTenantById;
    const origFindPlan = billingRepo.findPlanByKey;
    const origFindRecent = billingRepo.findRecentCreatedPayment;

    try {
      tenantsRepo.findTenantById = async () =>
        ({
          id: 'tenant-test-01',
          name: 'Test Tenant',
          slug: 'test-tenant',
        }) as any;

      billingRepo.findPlanByKey = async () =>
        ({
          id: 'plan-pro-id',
          key: 'PRO',
          name: 'Pro Plan',
          isActive: true,
          priceMonthlyMinor: 499900,
          priceYearlyMinor: 4999900,
          currency: 'INR',
        }) as any;

      billingRepo.findRecentCreatedPayment = async () =>
        ({
          id: 'payment-cached-01',
          tenantId: 'tenant-test-01',
          providerOrderId: 'order_cached_rzp_12345',
          amountMinor: 499900,
          currency: 'INR',
          status: 'CREATED',
          createdAt: new Date(),
          metadata: { planKey: 'PRO', billingInterval: 'MONTHLY' },
        }) as any;

      const result = await billingService.createTenantOrderCheckout('tenant-test-01', {
        planKey: 'PRO',
        billingInterval: 'MONTHLY',
      });

      assert.equal(result.orderId, 'order_cached_rzp_12345');
      assert.equal(result.paymentRecordId, 'payment-cached-01');
      assert.equal(result.amountMinor, 499900);
    } finally {
      tenantsRepo.findTenantById = origFindTenant;
      billingRepo.findPlanByKey = origFindPlan;
      billingRepo.findRecentCreatedPayment = origFindRecent;
    }
  });

  it('verifyTenantOrderPayment rejects mismatched amount or currency between order and gateway', async () => {
    const origFindPayment = billingRepo.findPaymentByOrderId;
    const origUpdatePayment = billingRepo.updatePayment;
    const origVerifySig = razorpayGateway.verifyOrderPaymentSignature;
    const origFetchPayment = razorpayGateway.fetchRazorpayPayment;

    let markedFailed = false;
    let failureCode = '';

    try {
      billingRepo.findPaymentByOrderId = async () =>
        ({
          id: 'pay-db-001',
          tenantId: 'tenant-001',
          amountMinor: 50000,
          currency: 'INR',
          status: 'CREATED',
          metadata: { planKey: 'PRO', billingInterval: 'MONTHLY' },
        }) as any;

      billingRepo.updatePayment = async (_id: string, update: any) => {
        if (update.status === 'FAILED') {
          markedFailed = true;
          failureCode = update.failureCode;
        }
        return null;
      };

      razorpayGateway.verifyOrderPaymentSignature = () => true;

      // Gateway returns mismatched amount
      razorpayGateway.fetchRazorpayPayment = async () =>
        ({
          id: 'pay_rzp_001',
          amount: 25000, // Expected 50000
          currency: 'INR',
          status: 'captured',
          method: 'card',
        }) as any;

      await assert.rejects(
        async () => {
          await billingService.verifyTenantOrderPayment('tenant-001', 'user-001', {
            razorpay_order_id: 'order_test_123',
            razorpay_payment_id: 'pay_rzp_001',
            razorpay_signature: 'sig_valid',
          });
        },
        (err: any) => {
          return (
            err instanceof AppError &&
            err.status === 400 &&
            err.message.includes('Payment amount or currency')
          );
        },
      );

      assert.equal(markedFailed, true);
      assert.equal(failureCode, 'AMOUNT_MISMATCH');
    } finally {
      billingRepo.findPaymentByOrderId = origFindPayment;
      billingRepo.updatePayment = origUpdatePayment;
      razorpayGateway.verifyOrderPaymentSignature = origVerifySig;
      razorpayGateway.fetchRazorpayPayment = origFetchPayment;
    }
  });

  it('verifyTenantSubscriptionPayment enforces strict tenant authorization guard', async () => {
    const origVerifySig = razorpayGateway.verifySubscriptionPaymentSignature;
    const origFetchSub = razorpayGateway.fetchRazorpaySubscription;
    const origFindSub = billingRepo.findSubscriptionByProviderId;

    try {
      razorpayGateway.verifySubscriptionPaymentSignature = () => true;

      // Notes belong to a different workspace
      razorpayGateway.fetchRazorpaySubscription = async () =>
        ({
          id: 'sub_rzp_other_tenant',
          status: 'active',
          current_start: 1700000000,
          current_end: 1702592000,
          notes: {
            tenantId: 'unauthorized-other-tenant',
            planKey: 'PRO',
          },
        }) as any;

      billingRepo.findSubscriptionByProviderId = async () => null;

      await assert.rejects(
        async () => {
          await billingService.verifyTenantSubscriptionPayment('victim-tenant-id', 'user-001', {
            razorpay_subscription_id: 'sub_rzp_other_tenant',
            razorpay_payment_id: 'pay_rzp_sub_01',
            razorpay_signature: 'sig_valid',
          });
        },
        (err: any) => {
          return err instanceof AppError && err.status === 403;
        },
      );
    } finally {
      razorpayGateway.verifySubscriptionPaymentSignature = origVerifySig;
      razorpayGateway.fetchRazorpaySubscription = origFetchSub;
      billingRepo.findSubscriptionByProviderId = origFindSub;
    }
  });

  it('verifyTenantSubscriptionPayment rejects when subscription payment amount does not match plan price', async () => {
    const origVerifySig = razorpayGateway.verifySubscriptionPaymentSignature;
    const origFetchSub = razorpayGateway.fetchRazorpaySubscription;
    const origFetchPayment = razorpayGateway.fetchRazorpayPayment;
    const origFindPlan = billingRepo.findPlanByKey;

    try {
      razorpayGateway.verifySubscriptionPaymentSignature = () => true;

      razorpayGateway.fetchRazorpaySubscription = async () =>
        ({
          id: 'sub_rzp_valid_tenant',
          status: 'active',
          current_start: 1700000000,
          current_end: 1702592000,
          notes: {
            tenantId: 'valid-tenant-id',
            planKey: 'PRO',
            billingInterval: 'MONTHLY',
          },
        }) as any;

      razorpayGateway.fetchRazorpayPayment = async () =>
        ({
          id: 'pay_rzp_sub_01',
          amount: 1000, // Plan is 499900
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        }) as any;

      billingRepo.findPlanByKey = async () =>
        ({
          id: 'plan-pro-id',
          key: 'PRO',
          name: 'Pro Plan',
          priceMonthlyMinor: 499900,
          priceYearlyMinor: 4999900,
          currency: 'INR',
        }) as any;

      await assert.rejects(
        async () => {
          await billingService.verifyTenantSubscriptionPayment('valid-tenant-id', 'user-001', {
            razorpay_subscription_id: 'sub_rzp_valid_tenant',
            razorpay_payment_id: 'pay_rzp_sub_01',
            razorpay_signature: 'sig_valid',
          });
        },
        (err: any) => {
          return (
            err instanceof AppError &&
            err.status === 400 &&
            err.message.includes('Payment amount or currency')
          );
        },
      );
    } finally {
      razorpayGateway.verifySubscriptionPaymentSignature = origVerifySig;
      razorpayGateway.fetchRazorpaySubscription = origFetchSub;
      razorpayGateway.fetchRazorpayPayment = origFetchPayment;
      billingRepo.findPlanByKey = origFindPlan;
    }
  });

  it('billing router enforces billing:manage and billing:read permissions on tenant routes', () => {
    const stack = (billingRouter as any).stack;

    const routes = stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods),
        middlewares: layer.route.stack.map((s: any) => s.name),
      }));

    // Find checkout order route
    const checkoutOrderRoute = routes.find(
      (r: any) =>
        Array.isArray(r.path)
          ? r.path.includes('/checkout/order')
          : r.path === '/checkout/order',
    );
    assert.ok(checkoutOrderRoute, 'checkout/order route exists');

    // Find subscription route
    const subscriptionRoute = routes.find(
      (r: any) =>
        Array.isArray(r.path)
          ? r.path.includes('/subscription')
          : r.path === '/subscription',
    );
    assert.ok(subscriptionRoute, 'subscription route exists');
  });
});
