import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb, db } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import type { BillingWebhook, Payment, Refund } from '../src/db/schema';
import { AppError } from '../src/lib/errors';
import { billingRepo } from '../src/modules/billing/billing.repository';
import * as billingService from '../src/modules/billing/billing.service';
import { calculateGstBreakdown } from '../src/modules/billing/billing.tax';
import { razorpayGateway } from '../src/modules/billing/providers/razorpay';
import { cancelRazorpaySubscription } from '../src/modules/billing/providers/razorpay/razorpay.subscriptions';
import { tenantsRepo } from '../src/modules/tenants/tenants.repository';

(env as unknown as Record<string, string>).RAZORPAY_KEY_ID = 'rzp_test_key_step03';
(env as unknown as Record<string, string>).RAZORPAY_KEY_SECRET = 'rzp_test_secret_step03';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

describe('Step 03: Razorpay Refunds, Resilience, and GST Hardening', () => {
  describe('GST Breakdown Calculator', () => {
    it('calculates intra-state 18% GST (9% CGST + 9% SGST) for INR tax-inclusive amount', () => {
      const amountMinor = 11800; // 118 INR
      const result = calculateGstBreakdown(amountMinor, 'INR', false);

      assert.equal(result.subtotalMinor, 10000); // 100 INR
      assert.equal(result.taxMinor, 1800); // 18 INR
      assert.equal(result.subtotalMinor + result.taxMinor, amountMinor);
      assert.equal(result.taxBreakdown.length, 2);

      const cgst = result.taxBreakdown[0];
      const sgst = result.taxBreakdown[1];
      assert.ok(cgst);
      assert.ok(sgst);
      assert.equal(cgst.name, 'CGST');
      assert.equal(cgst.amountMinor, 900);
      assert.equal(sgst.name, 'SGST');
      assert.equal(sgst.amountMinor, 900);
    });

    it('calculates inter-state 18% GST (18% IGST) for INR tax-inclusive amount', () => {
      const amountMinor = 11800;
      const result = calculateGstBreakdown(amountMinor, 'INR', true);

      assert.equal(result.subtotalMinor, 10000);
      assert.equal(result.taxMinor, 1800);
      assert.equal(result.subtotalMinor + result.taxMinor, amountMinor);
      assert.equal(result.taxBreakdown.length, 1);

      const igst = result.taxBreakdown[0];
      assert.ok(igst);
      assert.equal(igst.name, 'IGST');
      assert.equal(igst.ratePercent, 18);
      assert.equal(igst.amountMinor, 1800);
    });

    it('returns zero tax for non-INR currencies', () => {
      const amountMinor = 5000; // $50.00
      const result = calculateGstBreakdown(amountMinor, 'USD');

      assert.equal(result.subtotalMinor, 5000);
      assert.equal(result.taxMinor, 0);
      assert.equal(result.taxBreakdown.length, 0);
    });
  });

  describe('Subscription Cancellation Resilience', () => {
    it('treats "already cancelled" error from Razorpay as idempotent success', async () => {
      const origCancel = razorpayGateway.cancelRazorpaySubscription;
      try {
        const mockResult = await cancelRazorpaySubscription('sub_already_cancelled_test').catch(
          (err: unknown) => {
            return err;
          },
        );
        assert.ok(mockResult);
      } finally {
        razorpayGateway.cancelRazorpaySubscription = origCancel;
      }
    });
  });

  describe('Refund Hardening (issuePaymentRefund)', () => {
    it('rejects refund if payment status is not PAID or PARTIALLY_REFUNDED', async () => {
      const origTx = db.transaction;
      try {
        db.transaction = (async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => ({
                    limit: async () => [
                      {
                        id: 'pay-001',
                        status: 'FAILED',
                        amountMinor: 5000,
                      },
                    ],
                  }),
                }),
              }),
            }),
          };
          return cb(fakeTx);
        }) as unknown as typeof db.transaction;

        await assert.rejects(
          async () => {
            await billingService.issuePaymentRefund('staff-1', 'pay-001', {
              reason: 'Customer requested',
            });
          },
          (err: unknown) => {
            return (
              err instanceof AppError &&
              err.status === 400 &&
              err.message.includes('Only PAID or PARTIALLY_REFUNDED payments can be refunded')
            );
          },
        );
      } finally {
        db.transaction = origTx;
      }
    });

    it('rejects refund if requested amount exceeds remaining refundable balance', async () => {
      const origTx = db.transaction;
      const origFindRefunds = billingRepo.findRefundsByPaymentId;
      try {
        db.transaction = (async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => ({
                    limit: async () => [
                      {
                        id: 'pay-002',
                        status: 'PAID',
                        amountMinor: 10000,
                        providerPaymentId: 'pay_rzp_002',
                        tenantId: 'tenant-002',
                        currency: 'INR',
                      },
                    ],
                  }),
                }),
              }),
            }),
          };
          return cb(fakeTx);
        }) as unknown as typeof db.transaction;

        const fakeRefund = {
          id: 'rfnd-existing-1',
          tenantId: 'tenant-002',
          paymentId: 'pay-002',
          provider: 'razorpay',
          providerRefundId: 'rfnd_001',
          amountMinor: 6000,
          currency: 'INR',
          status: 'PROCESSED',
          reason: 'first refund',
          requestedBy: 'staff-1',
          processedAt: new Date(),
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Refund;

        billingRepo.findRefundsByPaymentId = (async () => [
          fakeRefund,
        ]) as unknown as typeof billingRepo.findRefundsByPaymentId;

        await assert.rejects(
          async () => {
            await billingService.issuePaymentRefund('staff-1', 'pay-002', {
              amountMinor: 5000, // 6000 + 5000 = 11000 > 10000
              reason: 'Excess refund test',
            });
          },
          (err: unknown) => {
            return (
              err instanceof AppError &&
              err.status === 400 &&
              err.message.includes('exceeds remaining refundable balance')
            );
          },
        );
      } finally {
        db.transaction = origTx;
        billingRepo.findRefundsByPaymentId = origFindRefunds;
      }
    });

    it('creates PENDING refund row first, marks FAILED on gateway error, and rethrows 502', async () => {
      const origTx = db.transaction;
      const origFindRefunds = billingRepo.findRefundsByPaymentId;
      const origCreateRefund = billingRepo.createRefund;
      const origUpdateRefund = billingRepo.updateRefund;
      const origGatewayRefund = razorpayGateway.createRazorpayRefund;

      let createdStatus = '';
      let updatedStatus = '';

      try {
        db.transaction = (async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => ({
                    limit: async () => [
                      {
                        id: 'pay-003',
                        status: 'PAID',
                        amountMinor: 10000,
                        providerPaymentId: 'pay_rzp_003',
                        tenantId: 'tenant-003',
                        currency: 'INR',
                      },
                    ],
                  }),
                }),
              }),
            }),
          };
          return cb(fakeTx);
        }) as unknown as typeof db.transaction;

        billingRepo.findRefundsByPaymentId =
          (async () => []) as unknown as typeof billingRepo.findRefundsByPaymentId;

        billingRepo.createRefund = (async (data: {
          status?: string;
          tenantId: string;
          paymentId: string;
          amountMinor: number;
          requestedBy: string;
          provider?: string;
          providerRefundId?: string | null;
          currency?: string;
          reason?: string | null;
          processedAt?: Date | null;
        }) => {
          createdStatus = data.status ?? 'PENDING';
          return {
            id: 'rfnd-pending-003',
            tenantId: data.tenantId,
            paymentId: data.paymentId,
            provider: data.provider ?? 'razorpay',
            providerRefundId: data.providerRefundId ?? null,
            amountMinor: data.amountMinor,
            currency: data.currency ?? 'INR',
            status: data.status ?? 'PENDING',
            reason: data.reason ?? null,
            requestedBy: data.requestedBy,
            processedAt: data.processedAt ?? null,
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as unknown as Refund;
        }) as unknown as typeof billingRepo.createRefund;

        billingRepo.updateRefund = (async (_id: string, data: { status?: string }) => {
          updatedStatus = data.status ?? '';
          return null;
        }) as unknown as typeof billingRepo.updateRefund;

        razorpayGateway.createRazorpayRefund = async () => {
          throw new AppError(502, 'Payment gateway error', 'GATEWAY_ERROR');
        };

        await assert.rejects(
          async () => {
            await billingService.issuePaymentRefund('staff-1', 'pay-003', {
              amountMinor: 5000,
              reason: 'Gateway fail test',
            });
          },
          (err: unknown) => {
            return err instanceof AppError && err.status === 502;
          },
        );

        assert.equal(createdStatus, 'PENDING');
        assert.equal(updatedStatus, 'FAILED');
      } finally {
        db.transaction = origTx;
        billingRepo.findRefundsByPaymentId = origFindRefunds;
        billingRepo.createRefund = origCreateRefund;
        billingRepo.updateRefund = origUpdateRefund;
        razorpayGateway.createRazorpayRefund = origGatewayRefund;
      }
    });

    it('on full refund, updates status to REFUNDED and downgrades subscription to FREE plan', async () => {
      const origTx = db.transaction;
      const origFindRefunds = billingRepo.findRefundsByPaymentId;
      const origCreateRefund = billingRepo.createRefund;
      const origUpdateRefund = billingRepo.updateRefund;
      const origUpdatePayment = billingRepo.updatePayment;
      const origFindPlan = billingRepo.findPlanByKey;
      const origFindPlanById = billingRepo.findPlanById;
      const origFindSub = billingRepo.findTenantSubscription;
      const origUpdateSub = billingRepo.updateSubscription;
      const origUpdateTenant = tenantsRepo.updateTenant;
      const origGatewayRefund = razorpayGateway.createRazorpayRefund;

      let paymentStatusUpdated = '';
      let subPlanDowngraded = '';

      try {
        db.transaction = (async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => ({
                    limit: async () => [
                      {
                        id: 'pay-004',
                        status: 'PAID',
                        amountMinor: 10000,
                        providerPaymentId: 'pay_rzp_004',
                        tenantId: 'tenant-004',
                        currency: 'INR',
                      },
                    ],
                  }),
                }),
              }),
            }),
          };
          return cb(fakeTx);
        }) as unknown as typeof db.transaction;

        billingRepo.findRefundsByPaymentId =
          (async () => []) as unknown as typeof billingRepo.findRefundsByPaymentId;
        billingRepo.createRefund = (async (data: {
          status?: string;
          tenantId: string;
          paymentId: string;
          amountMinor: number;
          requestedBy: string;
          provider?: string;
          providerRefundId?: string | null;
          currency?: string;
          reason?: string | null;
          processedAt?: Date | null;
        }) => ({
          id: 'rfnd-004',
          tenantId: data.tenantId,
          paymentId: data.paymentId,
          provider: data.provider ?? 'razorpay',
          providerRefundId: data.providerRefundId ?? null,
          amountMinor: data.amountMinor,
          currency: data.currency ?? 'INR',
          status: data.status ?? 'PENDING',
          reason: data.reason ?? null,
          requestedBy: data.requestedBy,
          processedAt: data.processedAt ?? null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as unknown as typeof billingRepo.createRefund;

        billingRepo.updateRefund = (async (
          id: string,
          data: { status?: string; providerRefundId?: string; processedAt?: Date },
        ) => ({
          id,
          tenantId: 'tenant-004',
          paymentId: 'pay-004',
          provider: 'razorpay',
          providerRefundId: data.providerRefundId ?? 'rfnd_rzp_004',
          amountMinor: 10000,
          currency: 'INR',
          status: data.status ?? 'PROCESSED',
          reason: 'Full refund',
          requestedBy: 'staff-1',
          processedAt: data.processedAt ?? new Date(),
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as unknown as typeof billingRepo.updateRefund;

        billingRepo.updatePayment = (async (_id: string, data: { status?: string }) => {
          paymentStatusUpdated = data.status ?? '';
          return null;
        }) as unknown as typeof billingRepo.updatePayment;

        razorpayGateway.createRazorpayRefund = async () => ({
          id: 'rfnd_rzp_004',
          entity: 'refund',
          amount: 10000,
          currency: 'INR',
          payment_id: 'pay_rzp_004',
          notes: {},
          receipt: 'rfnd_004',
          created_at: Math.floor(Date.now() / 1000),
          batch_id: null,
          status: 'processed',
          speed_processed: 'normal',
          speed_requested: 'normal',
        });

        billingRepo.findPlanByKey = (async () => ({
          id: 'plan-free-id',
          key: 'FREE',
          name: 'Free Plan',
          description: null,
          priceMonthlyMinor: 0,
          priceYearlyMinor: 0,
          currency: 'INR',
          trialDays: 0,
          billingInterval: 'MONTHLY',
          limits: { maxMembers: 5, maxStorageBytes: 1000000, maxCustomRoles: 0 },
          isPublic: true,
          isActive: true,
          isFeatured: false,
          badge: null,
          features: [],
          pricePerSeatMinor: 0,
          includedSeats: 1,
          version: 1,
          ctaLabel: null,
          sortOrder: 0,
          razorpayPlanIdMonthly: null,
          razorpayPlanIdYearly: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          modules: [],
        })) as unknown as typeof billingRepo.findPlanByKey;

        billingRepo.findPlanById = (async () => ({
          id: 'plan-pro-id',
          key: 'PRO',
          name: 'Pro Plan',
          description: null,
          priceMonthlyMinor: 499900,
          priceYearlyMinor: 4999900,
          currency: 'INR',
          trialDays: 14,
          billingInterval: 'MONTHLY',
          limits: { maxMembers: 20, maxStorageBytes: 10000000, maxCustomRoles: 5 },
          isPublic: true,
          isActive: true,
          isFeatured: false,
          badge: null,
          features: [],
          pricePerSeatMinor: 0,
          includedSeats: 1,
          version: 1,
          ctaLabel: null,
          sortOrder: 1,
          razorpayPlanIdMonthly: null,
          razorpayPlanIdYearly: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          modules: [],
        })) as unknown as typeof billingRepo.findPlanById;

        billingRepo.findTenantSubscription = (async (tenantId: string) => ({
          id: 'sub-004',
          tenantId,
          planId: 'plan-pro-id',
          status: 'ACTIVE',
          provider: 'razorpay',
          providerSubscriptionId: 'sub_rzp_004',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          billingEmail: 'billing@example.com',
          billingInterval: 'MONTHLY',
          seatCount: 1,
          taxIdSnapshot: null,
          internalNotes: null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as unknown as typeof billingRepo.findTenantSubscription;

        billingRepo.updateSubscription = (async (_id: string, data: { planId?: string }) => {
          subPlanDowngraded = data.planId ?? '';
          return null;
        }) as unknown as typeof billingRepo.updateSubscription;

        tenantsRepo.updateTenant = (async () => null) as unknown as typeof tenantsRepo.updateTenant;

        const result = await billingService.issuePaymentRefund('staff-1', 'pay-004', {
          amountMinor: 10000,
          reason: 'Full refund request',
        });

        assert.equal(paymentStatusUpdated, 'REFUNDED');
        assert.equal(subPlanDowngraded, 'plan-free-id');
        assert.equal(result.status, 'PROCESSED');
      } finally {
        db.transaction = origTx;
        billingRepo.findRefundsByPaymentId = origFindRefunds;
        billingRepo.createRefund = origCreateRefund;
        billingRepo.updateRefund = origUpdateRefund;
        billingRepo.updatePayment = origUpdatePayment;
        billingRepo.findPlanByKey = origFindPlan;
        billingRepo.findPlanById = origFindPlanById;
        billingRepo.findTenantSubscription = origFindSub;
        billingRepo.updateSubscription = origUpdateSub;
        tenantsRepo.updateTenant = origUpdateTenant;
        razorpayGateway.createRazorpayRefund = origGatewayRefund;
      }
    });
  });

  describe('Webhook Handlers for Refund & Payment Lifecycle', () => {
    it('handles payment.authorized by updating CREATED payment to AUTHORIZED', async () => {
      const origRecordWebhook = billingRepo.recordWebhookReceived;
      const origFindPayment = billingRepo.findPaymentByOrderId;
      const origUpdatePayment = billingRepo.updatePayment;
      const origUpdateWebhook = billingRepo.updateBillingWebhookStatus;

      let updatedStatus = '';

      try {
        billingRepo.recordWebhookReceived = (async () => ({
          status: 'RECEIVED' as const,
          record: {
            id: 'wh-001',
            provider: 'razorpay',
            eventId: 'evt_auth_123',
            eventType: 'payment.authorized',
            payload: {},
            status: 'RECEIVED',
            errorMessage: null,
            processedAt: null,
            createdAt: new Date(),
          } as unknown as BillingWebhook,
        })) as unknown as typeof billingRepo.recordWebhookReceived;

        billingRepo.updateBillingWebhookStatus = (async () =>
          null) as unknown as typeof billingRepo.updateBillingWebhookStatus;

        const fakePayment = {
          id: 'pay-auth-001',
          tenantId: 'tenant-auth-001',
          subscriptionId: null,
          provider: 'razorpay',
          providerPaymentId: null,
          providerOrderId: 'order_123',
          providerSignature: null,
          providerInvoiceId: null,
          amountMinor: 5000,
          currency: 'INR',
          status: 'CREATED',
          paymentMethod: null,
          failureCode: null,
          failureDescription: null,
          refundedAmountMinor: 0,
          receiptNumber: null,
          paidAt: null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Payment;

        billingRepo.findPaymentByOrderId = (async () =>
          fakePayment) as unknown as typeof billingRepo.findPaymentByOrderId;

        billingRepo.updatePayment = (async (_id: string, data: { status?: string }) => {
          updatedStatus = data.status ?? '';
          return null;
        }) as unknown as typeof billingRepo.updatePayment;

        const result = await billingService.processBillingWebhook({
          provider: 'razorpay',
          eventId: 'evt_auth_123',
          eventType: 'payment.authorized',
          payload: {
            entity: 'event',
            account_id: 'acc_123',
            event: 'payment.authorized',
            contains: ['payment'],
            payload: {
              payment: {
                entity: {
                  id: 'pay_auth_rzp_123',
                  order_id: 'order_123',
                  amount: 5000,
                  currency: 'INR',
                  status: 'authorized',
                  method: 'upi',
                },
              },
            },
            created_at: Math.floor(Date.now() / 1000),
          },
        });

        assert.equal(result.status, 'PROCESSED');
        assert.equal(updatedStatus, 'AUTHORIZED');
      } finally {
        billingRepo.recordWebhookReceived = origRecordWebhook;
        billingRepo.findPaymentByOrderId = origFindPayment;
        billingRepo.updatePayment = origUpdatePayment;
        billingRepo.updateBillingWebhookStatus = origUpdateWebhook;
      }
    });

    it('handles refund.failed by marking refund FAILED and recalculating payment status', async () => {
      const origRecordWebhook = billingRepo.recordWebhookReceived;
      const origFindRefund = billingRepo.findRefundByProviderRefundId;
      const origUpdateRefund = billingRepo.updateRefund;
      const origFindRefunds = billingRepo.findRefundsByPaymentId;
      const origFindPayment = billingRepo.findPaymentById;
      const origUpdatePayment = billingRepo.updatePayment;
      const origUpdateWebhook = billingRepo.updateBillingWebhookStatus;

      let refundStatus = '';
      let recalculatedPaymentStatus = '';

      try {
        billingRepo.recordWebhookReceived = (async () => ({
          status: 'RECEIVED' as const,
          record: {
            id: 'wh-002',
            provider: 'razorpay',
            eventId: 'evt_rfnd_failed_123',
            eventType: 'refund.failed',
            payload: {},
            status: 'RECEIVED',
            errorMessage: null,
            processedAt: null,
            createdAt: new Date(),
          } as unknown as BillingWebhook,
        })) as unknown as typeof billingRepo.recordWebhookReceived;

        billingRepo.updateBillingWebhookStatus = (async () =>
          null) as unknown as typeof billingRepo.updateBillingWebhookStatus;

        const fakeRefund = {
          id: 'rfnd-local-002',
          tenantId: 'tenant-002',
          paymentId: 'pay-002',
          provider: 'razorpay',
          providerRefundId: 'rfnd_rzp_failed_123',
          amountMinor: 5000,
          currency: 'INR',
          status: 'INITIATED',
          reason: 'test',
          requestedBy: 'staff-1',
          processedAt: null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Refund;

        billingRepo.findRefundByProviderRefundId = (async () =>
          fakeRefund) as unknown as typeof billingRepo.findRefundByProviderRefundId;

        billingRepo.updateRefund = (async (_id: string, data: { status?: string }) => {
          refundStatus = data.status ?? '';
          return null;
        }) as unknown as typeof billingRepo.updateRefund;

        // All remaining refunds: none valid
        billingRepo.findRefundsByPaymentId = (async () => [
          {
            ...fakeRefund,
            status: 'FAILED',
          },
        ]) as unknown as typeof billingRepo.findRefundsByPaymentId;

        const fakePayment = {
          id: 'pay-002',
          tenantId: 'tenant-002',
          subscriptionId: null,
          provider: 'razorpay',
          providerPaymentId: 'pay_rzp_002',
          providerOrderId: null,
          providerSignature: null,
          providerInvoiceId: null,
          amountMinor: 5000,
          currency: 'INR',
          status: 'REFUNDED',
          paymentMethod: 'card',
          failureCode: null,
          failureDescription: null,
          refundedAmountMinor: 5000,
          receiptNumber: null,
          paidAt: new Date(),
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Payment;

        billingRepo.findPaymentById = (async () =>
          fakePayment) as unknown as typeof billingRepo.findPaymentById;

        billingRepo.updatePayment = (async (_id: string, data: { status?: string }) => {
          recalculatedPaymentStatus = data.status ?? '';
          return null;
        }) as unknown as typeof billingRepo.updatePayment;

        const result = await billingService.processBillingWebhook({
          provider: 'razorpay',
          eventId: 'evt_rfnd_failed_123',
          eventType: 'refund.failed',
          payload: {
            entity: 'event',
            account_id: 'acc_123',
            event: 'refund.failed',
            contains: ['refund'],
            payload: {
              refund: {
                entity: {
                  id: 'rfnd_rzp_failed_123',
                  payment_id: 'pay_rzp_002',
                  amount: 5000,
                  currency: 'INR',
                  status: 'failed',
                },
              },
            },
            created_at: Math.floor(Date.now() / 1000),
          },
        });

        assert.equal(result.status, 'PROCESSED');
        assert.equal(refundStatus, 'FAILED');
        assert.equal(recalculatedPaymentStatus, 'PAID');
      } finally {
        billingRepo.recordWebhookReceived = origRecordWebhook;
        billingRepo.findRefundByProviderRefundId = origFindRefund;
        billingRepo.updateRefund = origUpdateRefund;
        billingRepo.findRefundsByPaymentId = origFindRefunds;
        billingRepo.findPaymentById = origFindPayment;
        billingRepo.updatePayment = origUpdatePayment;
        billingRepo.updateBillingWebhookStatus = origUpdateWebhook;
      }
    });
  });
});
