import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import {
  invoices,
  payments,
  subscriptionEvents,
  subscriptions,
  type Payment,
  type Subscription,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import * as platformRepo from '@/modules/platform/platform.repository';
import { tenantsRepo } from '@/modules/tenants/tenants.repository';
import { emitToUser } from '@/sockets/emitter';

import { invalidateTenantBillingCache, onPlanChanged } from './billing-plans-entitlements.service';
import type {
  BillingWebhookDto,
  CheckoutOrderDto,
  CheckoutSubscriptionDto,
  IssueRefundDto,
  ListPaymentsQueryDto,
  ListPlatformPaymentsQueryDto,
  VerifyOrderPaymentDto,
  VerifySubscriptionPaymentDto,
} from './billing.dto';
import { billingRepo } from './billing.repository';
import { calculateGstBreakdown } from './billing.tax';
import { DEFAULT_PLAN_KEY } from './plans.defaults';
import { razorpayGateway } from './providers/razorpay';

// ==========================================
// 5. Webhooks & Idempotent Processing
// ==========================================

export async function processBillingWebhook(dto: BillingWebhookDto) {
  const { provider, eventId, eventType, payload } = dto;

  // 1. Atomic insert first with status 'RECEIVED' to lock eventId
  const inserted = billingRepo.recordWebhookReceived
    ? await billingRepo.recordWebhookReceived({
        provider,
        eventId,
        eventType,
        payload,
      })
    : await billingRepo.createBillingWebhook({
        provider,
        eventId,
        eventType,
        payload,
        status: 'RECEIVED',
      });

  let webhookRecordId = '';
  let activeRecord = inserted;
  if (!inserted) {
    const existing = await billingRepo.findBillingWebhook(provider, eventId);
    if (existing && (existing.status === 'PROCESSED' || existing.status === 'RECEIVED')) {
      return {
        status: 'DUPLICATE_IGNORED',
        idempotent: true,
        eventId,
        processedAt: existing.processedAt,
        record: existing,
      };
    }
    webhookRecordId = existing ? existing.id : '';
    activeRecord = existing;
  } else {
    webhookRecordId = inserted.id;
  }

  try {
    // Only handle authenticated razorpay provider events
    if (provider === 'razorpay') {
      const pEntity = (payload as any)?.payload?.payment?.entity;
      const oEntity = (payload as any)?.payload?.order?.entity;
      const sEntity = (payload as any)?.payload?.subscription?.entity;
      const rEntity = (payload as any)?.payload?.refund?.entity;

      // Handle payment.captured / order.paid
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        const orderId = pEntity?.order_id ?? oEntity?.id;
        const paymentId = pEntity?.id;

        // Resolve payment and tenant from DB, not from untrusted payload notes alone
        const localPayment = orderId
          ? await billingRepo.findPaymentByOrderId(orderId)
          : paymentId
            ? await billingRepo.findPaymentByPaymentId(paymentId)
            : null;

        if (localPayment) {
          // If notes are present, verify tenant matches
          const notesTenantId = pEntity?.notes?.tenantId ?? oEntity?.notes?.tenantId;
          if (notesTenantId && notesTenantId !== localPayment.tenantId) {
            logger.warn(
              { notesTenantId, localTenantId: localPayment.tenantId, orderId },
              'Razorpay webhook tenant mismatch on payment',
            );
            throw AppError.badRequest('Webhook tenant identity mismatch');
          }

          // Validate amount and currency against expected local payment record
          const eventAmount = Number(pEntity?.amount ?? oEntity?.amount ?? 0);
          const eventCurrency = (pEntity?.currency ?? oEntity?.currency ?? '').toUpperCase();
          if (
            (eventAmount > 0 && eventAmount !== localPayment.amountMinor) ||
            (eventCurrency && eventCurrency !== localPayment.currency.toUpperCase())
          ) {
            logger.warn(
              {
                localPaymentId: localPayment.id,
                expectedAmount: localPayment.amountMinor,
                expectedCurrency: localPayment.currency,
                eventAmount,
                eventCurrency,
              },
              'Payment amount or currency mismatch on webhook',
            );
            await billingRepo.updatePayment(localPayment.id, {
              status: 'FAILED',
              failureCode: 'AMOUNT_MISMATCH',
              failureDescription: `Amount or currency mismatch: received ${eventAmount} ${eventCurrency}, expected ${localPayment.amountMinor} ${localPayment.currency}`,
            });
          } else {
            // Share unified activation function
            await activatePaidOrder({
              paymentId: localPayment.id,
              providerPaymentId: paymentId,
              paymentMethod: pEntity?.method,
            });
          }
        }
      } else if (eventType === 'payment.authorized') {
        const orderId = pEntity?.order_id ?? oEntity?.id;
        const paymentId = pEntity?.id;
        const localPayment = orderId
          ? await billingRepo.findPaymentByOrderId(orderId)
          : paymentId
            ? await billingRepo.findPaymentByPaymentId(paymentId)
            : null;

        if (localPayment && localPayment.status === 'CREATED') {
          await billingRepo.updatePayment(localPayment.id, {
            status: 'AUTHORIZED',
            providerPaymentId: paymentId ?? localPayment.providerPaymentId,
            paymentMethod: pEntity?.method ?? localPayment.paymentMethod,
          });
        }
      } else if (eventType === 'payment.failed') {
        const orderId = pEntity?.order_id ?? oEntity?.id;
        const paymentId = pEntity?.id;
        const localPayment = orderId
          ? await billingRepo.findPaymentByOrderId(orderId)
          : paymentId
            ? await billingRepo.findPaymentByPaymentId(paymentId)
            : null;

        if (localPayment) {
          await billingRepo.updatePayment(localPayment.id, {
            status: 'FAILED',
            failureCode: pEntity?.error_code ?? 'PAYMENT_FAILED',
            failureDescription: pEntity?.error_description ?? 'Payment attempt failed',
          });
        }
      } else if (
        eventType === 'subscription.authenticated' ||
        eventType === 'subscription.activated' ||
        eventType === 'subscription.charged'
      ) {
        const rzpSubId = sEntity?.id;
        const notes = sEntity?.notes ?? {};
        const planKey = notes.planKey;

        // Resolve subscription from DB first by providerSubscriptionId
        const existingSub = rzpSubId
          ? await billingRepo.findSubscriptionByProviderId(rzpSubId)
          : null;
        const tenantId = existingSub?.tenantId ?? notes.tenantId;

        if (existingSub && notes.tenantId && existingSub.tenantId !== notes.tenantId) {
          logger.warn(
            { notesTenantId: notes.tenantId, existingTenantId: existingSub.tenantId, rzpSubId },
            'Razorpay webhook tenant mismatch on subscription',
          );
          throw AppError.badRequest('Webhook tenant identity mismatch on subscription');
        }

        if (rzpSubId && tenantId) {
          const sub = existingSub ?? (await billingRepo.findTenantSubscription(tenantId));
          const plan = planKey ? await billingRepo.findPlanByKey(planKey) : null;

          const currentPeriodStart = sEntity?.current_start
            ? new Date(sEntity.current_start * 1000)
            : new Date();
          const currentPeriodEnd = sEntity?.current_end
            ? new Date(sEntity.current_end * 1000)
            : new Date(Date.now() + 30 * 86400000);

          const fromPlanId = sub?.planId;

          if (sub) {
            await billingRepo.updateSubscription(sub.id, {
              status: 'ACTIVE',
              provider: 'razorpay',
              providerSubscriptionId: rzpSubId,
              currentPeriodStart,
              currentPeriodEnd,
              planId: plan?.id ?? sub.planId,
            });
          } else if (plan) {
            await billingRepo.createSubscription({
              tenantId,
              planId: plan.id,
              status: 'ACTIVE',
              provider: 'razorpay',
              providerSubscriptionId: rzpSubId,
              currentPeriodStart,
              currentPeriodEnd,
            });
          }

          if (plan) {
            const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
            const oldPlanKey = oldPlan?.key ?? null;
            if (oldPlanKey !== plan.key) {
              await onPlanChanged(tenantId, oldPlanKey, plan.key);
            } else {
              await invalidateTenantBillingCache(tenantId);
            }
          } else {
            await invalidateTenantBillingCache(tenantId);
          }
        }
      } else if (eventType === 'subscription.halted' || eventType === 'subscription.pending') {
        const rzpSubId = sEntity?.id;
        const notes = sEntity?.notes ?? {};
        const sub = rzpSubId ? await billingRepo.findSubscriptionByProviderId(rzpSubId) : null;
        const tenantId = sub?.tenantId ?? notes.tenantId;

        if (tenantId) {
          logger.warn(
            { tenantId, rzpSubId, eventType },
            'Subscription halted or pending payment; dunning alert recorded',
          );
          const activeSub = sub ?? (await billingRepo.findTenantSubscription(tenantId));
          if (activeSub) {
            await billingRepo.updateSubscription(activeSub.id, {
              status: 'PAST_DUE',
            });
            await invalidateTenantBillingCache(tenantId);
          }
        }
      } else if (eventType === 'subscription.cancelled' || eventType === 'subscription.completed') {
        const rzpSubId = sEntity?.id;
        const notes = sEntity?.notes ?? {};
        const sub = rzpSubId ? await billingRepo.findSubscriptionByProviderId(rzpSubId) : null;
        const tenantId = sub?.tenantId ?? notes.tenantId;

        if (tenantId) {
          const activeSub = sub ?? (await billingRepo.findTenantSubscription(tenantId));
          if (activeSub) {
            await billingRepo.updateSubscription(activeSub.id, {
              status: 'CANCELED',
            });
            await invalidateTenantBillingCache(tenantId);
          }
        }
      } else if (eventType === 'refund.created') {
        const refundId = rEntity?.id;
        const paymentId = rEntity?.payment_id;
        if (refundId) {
          const localRefund = await billingRepo.findRefundByProviderRefundId(refundId);
          if (!localRefund && paymentId) {
            const payment = await billingRepo.findPaymentByPaymentId(paymentId);
            if (payment) {
              await billingRepo.createRefund({
                tenantId: payment.tenantId,
                paymentId: payment.id,
                provider: 'razorpay',
                providerRefundId: refundId,
                amountMinor: Number(rEntity?.amount ?? 0),
                currency: rEntity?.currency ?? payment.currency,
                status: 'INITIATED',
                requestedBy: 'razorpay_webhook',
              });
            }
          }
        }
      } else if (eventType === 'refund.processed') {
        const refundId = rEntity?.id;
        if (refundId) {
          const localRefund = await billingRepo.findRefundByProviderRefundId(refundId);
          if (localRefund) {
            await billingRepo.updateRefund(localRefund.id, {
              status: 'PROCESSED',
              processedAt: new Date(),
            });
          }
        }
      } else if (eventType === 'refund.failed') {
        const refundId = rEntity?.id;
        if (refundId) {
          const localRefund = await billingRepo.findRefundByProviderRefundId(refundId);
          if (localRefund) {
            await billingRepo.updateRefund(localRefund.id, {
              status: 'FAILED',
            });
            // Recalculate parent payment status based on remaining valid refunds
            const allRefunds = await billingRepo.findRefundsByPaymentId(localRefund.paymentId);
            const validRefundedSum = allRefunds
              .filter(
                (r) => r.id !== localRefund.id && ['INITIATED', 'PROCESSED'].includes(r.status),
              )
              .reduce((sum, r) => sum + r.amountMinor, 0);

            const payment = await billingRepo.findPaymentById(localRefund.paymentId);
            if (payment) {
              let newStatus: 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' = 'PAID';
              if (validRefundedSum >= payment.amountMinor) {
                newStatus = 'REFUNDED';
              } else if (validRefundedSum > 0) {
                newStatus = 'PARTIALLY_REFUNDED';
              }
              await billingRepo.updatePayment(payment.id, {
                status: newStatus,
              });
            }
          }
        }
      }
    }

    if (webhookRecordId && billingRepo.updateBillingWebhookStatus) {
      await billingRepo.updateBillingWebhookStatus(webhookRecordId, 'PROCESSED', null);
    }

    return {
      status: 'PROCESSED',
      idempotent: false,
      eventId,
      eventType,
      record: activeRecord ?? { id: webhookRecordId, eventId, provider, eventType },
    };
  } catch (err: any) {
    if (webhookRecordId) {
      await billingRepo.updateBillingWebhookStatus(
        webhookRecordId,
        'FAILED',
        err?.message || 'Webhook processing failed',
      );
    }
    logger.error({ err, eventId, eventType }, 'Billing webhook processing failed');
    throw AppError.internal('Webhook processing failed, retrying');
  }
}

// ==========================================
// 7. Razorpay Checkout, Payments & Refunds
// ==========================================

export interface ActivatePaidOrderParams {
  paymentId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerSignature?: string;
  paymentMethod?: string;
  actorUserId?: string;
}

export interface ActivatePaidOrderResult {
  success: boolean;
  status: string;
  alreadyProcessed: boolean;
  planKey: string;
  planName: string;
  subscriptionId: string;
  paymentId: string;
  tenantId: string;
}

/**
 * Shared atomic activation function for Razorpay orders (used by both verify endpoint and webhooks).
 * Acquires a SELECT ... FOR UPDATE lock on the payment row to guarantee atomic, once-and-only-once execution.
 */
export async function activatePaidOrder(
  params: ActivatePaidOrderParams,
): Promise<ActivatePaidOrderResult> {
  let postActivationAction: {
    tenantId: string;
    oldPlanKey: string | null;
    newPlanKey: string;
    actorUserId?: string;
    orderId?: string | null;
    paymentId?: string;
    planName: string;
  } | null = null;

  const result = await db.transaction(async (tx) => {
    let payment: Payment | null = null;
    if (params.paymentId) {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, params.paymentId))
        .for('update');
      payment = row ?? null;
    } else if (params.providerOrderId) {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, params.providerOrderId))
        .for('update');
      payment = row ?? null;
    }

    if (!payment) {
      throw AppError.notFound('Payment record not found');
    }

    const meta = (payment.metadata ?? {}) as Record<string, any>;
    const targetPlanKey = (meta.planKey ?? 'PRO').toUpperCase();
    const plan =
      (await billingRepo.findPlanByKey(targetPlanKey, tx)) ??
      (meta.planId ? await billingRepo.findPlanById(meta.planId, tx) : null);

    if (!plan) {
      throw AppError.notFound(`Plan "${targetPlanKey}" not found`);
    }

    // Idempotency check: if already PAID, return idempotent success
    if (payment.status === 'PAID') {
      const existingSub = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tenantId, payment.tenantId),
            sql`${subscriptions.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
          ),
        )
        .limit(1);

      return {
        success: true,
        status: 'PAID',
        alreadyProcessed: true,
        planKey: plan.key,
        planName: plan.name,
        subscriptionId: payment.subscriptionId ?? existingSub[0]?.id ?? '',
        paymentId: payment.id,
        tenantId: payment.tenantId,
      };
    }

    const paidAt = new Date();
    const [updatedPayment] = await tx
      .update(payments)
      .set({
        status: 'PAID',
        providerPaymentId: params.providerPaymentId ?? payment.providerPaymentId,
        providerSignature: params.providerSignature ?? payment.providerSignature,
        paymentMethod: params.paymentMethod ?? payment.paymentMethod,
        paidAt,
        updatedAt: paidAt,
      })
      .where(eq(payments.id, payment.id))
      .returning();

    if (!updatedPayment) {
      throw AppError.internal('Failed to update payment status');
    }

    // Period calculation: extend from current period end if still active
    const isAnnual = meta.billingInterval === 'ANNUAL';
    const now = new Date();

    const [existingSub] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, payment.tenantId),
          sql`${subscriptions.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
        ),
      )
      .limit(1);

    const baseStart =
      existingSub?.status === 'ACTIVE' &&
      existingSub?.currentPeriodEnd &&
      new Date(existingSub.currentPeriodEnd) > now
        ? new Date(existingSub.currentPeriodEnd)
        : now;

    const currentPeriodStart = baseStart === now ? now : (existingSub?.currentPeriodStart ?? now);
    const currentPeriodEnd = new Date(baseStart.getTime());
    if (isAnnual) {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    const fromPlanId = existingSub?.planId ?? null;
    let subRecord: Subscription;

    if (existingSub) {
      const [updated] = await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
          cancelAtPeriodEnd: false,
          provider: 'razorpay',
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existingSub.id))
        .returning();
      if (!updated) {
        throw AppError.internal('Failed to update subscription record');
      }
      subRecord = updated;
    } else {
      const [created] = await tx
        .insert(subscriptions)
        .values({
          tenantId: payment.tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
          provider: 'razorpay',
        })
        .returning();
      if (!created) {
        throw AppError.internal('Failed to create subscription record');
      }
      subRecord = created;
    }

    if (!updatedPayment.subscriptionId) {
      await tx
        .update(payments)
        .set({ subscriptionId: subRecord.id })
        .where(eq(payments.id, updatedPayment.id));
    }

    // Auto-generate invoice with GST breakdown
    const gst = calculateGstBreakdown(payment.amountMinor, payment.currency, false);
    const tenant = await tenantsRepo.findTenantById(payment.tenantId);
    const generatedInv = await billingRepo.generateInvoiceNumber(now.getFullYear(), tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId: payment.tenantId,
        subscriptionId: subRecord.id,
        planId: plan.id,
        invoiceNumber: generatedInv.invoiceNumber,
        invoiceYear: generatedInv.year,
        invoiceSeq: generatedInv.seq,
        amountCents: gst.subtotalMinor,
        taxCents: gst.taxMinor,
        totalCents: payment.amountMinor,
        subtotalMinor: gst.subtotalMinor,
        taxBreakdown: gst.taxBreakdown,
        customerSnapshot: {
          name: tenant?.name ?? 'Workspace',
          email: tenant?.slug ? `${tenant.slug}@example.com` : '',
        },
        currency: payment.currency,
        status: 'PAID',
        paidAt: now,
        billingPeriodStart: currentPeriodStart,
        billingPeriodEnd: currentPeriodEnd,
        lineItems: [
          {
            description: `${plan.name} Plan (${isAnnual ? 'Annual' : 'Monthly'})`,
            quantity: 1,
            unitPriceCents: gst.subtotalMinor,
            totalCents: gst.subtotalMinor,
          },
        ],
      })
      .returning();

    if (!invoice) {
      throw AppError.internal('Failed to generate invoice record');
    }

    // Log subscription event
    await tx.insert(subscriptionEvents).values({
      subscriptionId: subRecord.id,
      tenantId: payment.tenantId,
      type: 'PURCHASED',
      fromPlanId,
      toPlanId: plan.id,
      actorType: params.actorUserId ? 'USER' : 'SYSTEM',
      actorId: params.actorUserId ?? 'system',
      metadata: {
        orderId: payment.providerOrderId,
        paymentId: updatedPayment.providerPaymentId,
        planKey: plan.key,
        billingInterval: isAnnual ? 'ANNUAL' : 'MONTHLY',
        invoiceId: invoice.id,
      },
    });

    const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId, tx) : null;

    postActivationAction = {
      tenantId: payment.tenantId,
      oldPlanKey: oldPlan?.key ?? null,
      newPlanKey: plan.key,
      actorUserId: params.actorUserId,
      orderId: payment.providerOrderId,
      paymentId: updatedPayment.providerPaymentId ?? undefined,
      planName: plan.name,
    };

    return {
      success: true,
      status: 'PAID',
      alreadyProcessed: false,
      planKey: plan.key,
      planName: plan.name,
      subscriptionId: subRecord.id,
      paymentId: updatedPayment.id,
      tenantId: payment.tenantId,
    };
  });

  // Post-transaction notifications and cache sync
  if (postActivationAction) {
    const { tenantId, oldPlanKey, newPlanKey, actorUserId, orderId, paymentId, planName } =
      postActivationAction;
    if (oldPlanKey !== newPlanKey) {
      await onPlanChanged(tenantId, oldPlanKey, newPlanKey);
    } else {
      await invalidateTenantBillingCache(tenantId);
    }

    if (actorUserId) {
      emitToUser(actorUserId, 'billing:payment_success', {
        orderId,
        paymentId,
        planKey: newPlanKey,
        planName,
      });
    }
  }

  return result;
}

export async function createTenantOrderCheckout(tenantId: string, dto: CheckoutOrderDto) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const plan = await billingRepo.findPlanByKey(dto.planKey);
  if (!plan) throw AppError.notFound(`Plan "${dto.planKey}" not found`);
  if (!plan.isActive)
    throw AppError.badRequest(`Plan "${dto.planKey}" is not available for purchase`);

  const isAnnual = dto.billingInterval === 'ANNUAL';
  const amountMinor = isAnnual ? plan.priceYearlyMinor : plan.priceMonthlyMinor;

  if (amountMinor <= 0) {
    throw AppError.badRequest('Free plans do not require a checkout payment');
  }

  const keyId = env.RAZORPAY_KEY_ID;
  if (!keyId) {
    throw AppError.internal('Razorpay key ID is not configured on the server');
  }

  // Idempotency: reuse existing CREATED payment for same tenant + plan + interval in the last 15 min
  const existingPayment = await billingRepo.findRecentCreatedPayment(
    tenantId,
    plan.key,
    dto.billingInterval,
    15 * 60 * 1000,
  );
  if (existingPayment && existingPayment.providerOrderId) {
    return {
      keyId,
      orderId: existingPayment.providerOrderId,
      amountMinor: existingPayment.amountMinor,
      currency: existingPayment.currency,
      planName: plan.name,
      paymentRecordId: existingPayment.id,
    };
  }

  // 1. Create a local pending payment record before calling provider
  const localPayment = await billingRepo.createPayment({
    tenantId,
    provider: 'razorpay',
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    status: 'CREATED',
    metadata: {
      planKey: plan.key,
      planId: plan.id,
      billingInterval: dto.billingInterval,
    },
  });

  // 2. Call Razorpay Orders API with deterministic receipt
  const receipt = `rcpt_${tenantId.slice(0, 8)}_${localPayment.id.slice(0, 8)}`;
  const order = await razorpayGateway.createRazorpayOrder({
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    receipt,
    notes: {
      tenantId,
      planKey: plan.key,
      billingInterval: dto.billingInterval,
      paymentRecordId: localPayment.id,
    },
  });

  // 3. Link provider order ID
  await billingRepo.updatePayment(localPayment.id, {
    providerOrderId: order.id,
  });

  return {
    keyId,
    orderId: order.id,
    amountMinor: order.amount,
    currency: order.currency,
    planName: plan.name,
    paymentRecordId: localPayment.id,
  };
}

export async function verifyTenantOrderPayment(
  tenantId: string,
  actorUserId: string,
  dto: VerifyOrderPaymentDto,
) {
  // 1. Find local pending payment record
  const localPayment = await billingRepo.findPaymentByOrderId(dto.razorpay_order_id);
  if (!localPayment || localPayment.tenantId !== tenantId) {
    throw AppError.notFound('Payment order not found for this workspace');
  }

  // 2. If already marked paid, return success idempotently
  if (localPayment.status === 'PAID') {
    return {
      success: true,
      status: 'PAID',
      message: 'Payment has already been verified and processed',
      paymentId: localPayment.id,
    };
  }

  // 3. Server-side signature verification
  const isValid = razorpayGateway.verifyOrderPaymentSignature({
    orderId: dto.razorpay_order_id,
    paymentId: dto.razorpay_payment_id,
    signature: dto.razorpay_signature,
  });

  if (!isValid) {
    throw AppError.badRequest('Invalid payment signature from payment gateway');
  }

  // 4. Fetch payment details from Razorpay to confirm capture
  const rzpPayment = await razorpayGateway.fetchRazorpayPayment(dto.razorpay_payment_id);
  if (rzpPayment.status !== 'captured' && rzpPayment.status !== 'authorized') {
    throw AppError.badRequest(`Payment status is not captured (current: ${rzpPayment.status})`);
  }

  // 5. Validate amount and currency
  const rzpAmount = Number(rzpPayment.amount ?? 0);
  const rzpCurrency = (rzpPayment.currency ?? '').toUpperCase();
  if (
    rzpAmount !== localPayment.amountMinor ||
    rzpCurrency !== localPayment.currency.toUpperCase()
  ) {
    await billingRepo.updatePayment(localPayment.id, {
      status: 'FAILED',
      failureCode: 'AMOUNT_MISMATCH',
      failureDescription: 'Payment amount or currency mismatch',
    });
    throw AppError.badRequest('Payment amount or currency does not match order');
  }

  // 6. Unified atomic activation function
  const result = await activatePaidOrder({
    paymentId: localPayment.id,
    providerPaymentId: dto.razorpay_payment_id,
    providerSignature: dto.razorpay_signature,
    paymentMethod: rzpPayment.method,
    actorUserId,
  });

  return {
    success: true,
    status: 'PAID',
    planKey: result.planKey,
    planName: result.planName,
    subscriptionId: result.subscriptionId,
    paymentId: result.paymentId,
  };
}

export async function createTenantSubscriptionCheckout(
  tenantId: string,
  dto: CheckoutSubscriptionDto,
) {
  const tenant = await tenantsRepo.findTenantById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');

  const plan = await billingRepo.findPlanByKey(dto.planKey);
  if (!plan) throw AppError.notFound(`Plan "${dto.planKey}" not found`);
  if (!plan.isActive)
    throw AppError.badRequest(`Plan "${dto.planKey}" is not available for purchase`);

  const keyId = env.RAZORPAY_KEY_ID;
  if (!keyId) {
    throw AppError.internal('Razorpay key ID is not configured on the server');
  }

  const isAnnual = dto.billingInterval === 'ANNUAL';
  const amountMinor = isAnnual ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
  if (amountMinor <= 0) {
    throw AppError.badRequest('Free plans do not require a subscription checkout');
  }

  // Lazy plan creation: store razorpayPlanIdMonthly/Yearly on local Plan and reuse
  let rzpPlanId = isAnnual ? plan.razorpayPlanIdYearly : plan.razorpayPlanIdMonthly;
  if (!rzpPlanId) {
    const createdPlan = await razorpayGateway.createRazorpayPlan({
      period: isAnnual ? 'yearly' : 'monthly',
      interval: 1,
      name: `${plan.name} (${isAnnual ? 'Annual' : 'Monthly'})`,
      amountMinor,
      currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
      description: plan.description ?? undefined,
    });
    rzpPlanId = createdPlan.id;
    await billingRepo.updatePlan(plan.id, {
      [isAnnual ? 'razorpayPlanIdYearly' : 'razorpayPlanIdMonthly']: rzpPlanId,
    });
  }

  // Create recurring subscription in Razorpay
  const rzpSub = await razorpayGateway.createRazorpaySubscription({
    planId: rzpPlanId,
    totalCount: dto.totalCount,
    notes: {
      tenantId,
      tenantSlug: tenant.slug,
      planKey: plan.key,
      planId: plan.id,
      billingInterval: dto.billingInterval,
    },
  });

  // Persist a local pending subscription/payment mapping (providerSubscriptionId -> tenantId)
  await billingRepo.createPayment({
    tenantId,
    provider: 'razorpay',
    amountMinor,
    currency: plan.currency || env.RAZORPAY_CURRENCY || 'INR',
    status: 'CREATED',
    metadata: {
      providerSubscriptionId: rzpSub.id,
      planKey: plan.key,
      planId: plan.id,
      billingInterval: dto.billingInterval,
    },
  });

  return {
    keyId,
    subscriptionId: rzpSub.id,
    planName: plan.name,
    amountMinor,
    currency: plan.currency,
  };
}

export async function verifyTenantSubscriptionPayment(
  tenantId: string,
  actorUserId: string,
  dto: VerifySubscriptionPaymentDto,
) {
  // 1. Verify recurring subscription payment signature
  const isValid = razorpayGateway.verifySubscriptionPaymentSignature({
    subscriptionId: dto.razorpay_subscription_id,
    paymentId: dto.razorpay_payment_id,
    signature: dto.razorpay_signature,
  });

  if (!isValid) {
    throw AppError.badRequest('Invalid recurring subscription signature');
  }

  // 2. Fetch the subscription from Razorpay; require notes.tenantId === tenantId or local mapping
  const rzpSub = await razorpayGateway.fetchRazorpaySubscription(dto.razorpay_subscription_id);
  const subNotes = (rzpSub.notes ?? {}) as Record<string, string>;

  let isTenantAuthorized = subNotes.tenantId === tenantId;
  if (!isTenantAuthorized) {
    const localSub = await billingRepo.findSubscriptionByProviderId(dto.razorpay_subscription_id);
    if (localSub && localSub.tenantId === tenantId) {
      isTenantAuthorized = true;
    }
  }

  if (!isTenantAuthorized) {
    throw AppError.forbidden('Unauthorized subscription verification for this workspace');
  }

  // 3. Fetch payment; require status captured or authorized
  const rzpPayment = await razorpayGateway.fetchRazorpayPayment(dto.razorpay_payment_id);
  if (rzpPayment.status !== 'captured' && rzpPayment.status !== 'authorized') {
    throw AppError.badRequest(`Payment status is not captured (current: ${rzpPayment.status})`);
  }

  // Resolve plan from subscription notes
  const targetPlanKey = (subNotes.planKey ?? 'PRO').toUpperCase();
  const plan =
    (await billingRepo.findPlanByKey(targetPlanKey)) ??
    (subNotes.planId ? await billingRepo.findPlanById(subNotes.planId) : null);

  if (!plan) {
    throw AppError.notFound(`Plan "${targetPlanKey}" not found for subscription`);
  }

  const billingInterval = subNotes.billingInterval === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
  const isAnnual = billingInterval === 'ANNUAL';
  const expectedAmount = isAnnual ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
  const rzpAmount = Number(rzpPayment.amount ?? 0);
  const rzpCurrency = (rzpPayment.currency ?? '').toUpperCase();

  if (
    rzpAmount !== expectedAmount ||
    (rzpCurrency && rzpCurrency !== (plan.currency || 'INR').toUpperCase())
  ) {
    throw AppError.badRequest('Payment amount or currency does not match subscription plan');
  }

  // 4. DB transaction with atomic updates
  const { sub, payment, fromPlanId } = await db.transaction(async (tx) => {
    // Set period from Razorpay subscription current_start/current_end (not a hardcoded 30 days)
    const currentPeriodStart = rzpSub.current_start
      ? new Date(rzpSub.current_start * 1000)
      : new Date();
    const currentPeriodEnd = rzpSub.current_end
      ? new Date(rzpSub.current_end * 1000)
      : isAnnual
        ? new Date(Date.now() + 365 * 86400000)
        : new Date(Date.now() + 30 * 86400000);

    const [existingSub] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, tenantId),
          sql`${subscriptions.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
        ),
      )
      .limit(1);

    const prevPlanId = existingSub?.planId ?? null;
    let activeSub: Subscription;

    if (existingSub) {
      const [updated] = await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: 'ACTIVE',
          provider: 'razorpay',
          providerSubscriptionId: dto.razorpay_subscription_id,
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existingSub.id))
        .returning();
      if (!updated) {
        throw AppError.internal('Failed to update subscription record');
      }
      activeSub = updated;
    } else {
      const [created] = await tx
        .insert(subscriptions)
        .values({
          tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          provider: 'razorpay',
          providerSubscriptionId: dto.razorpay_subscription_id,
          currentPeriodStart,
          currentPeriodEnd,
          billingInterval,
        })
        .returning();
      if (!created) {
        throw AppError.internal('Failed to create subscription record');
      }
      activeSub = created;
    }

    // Idempotent payment upsert
    const paidPayment = await billingRepo.upsertPayment(
      {
        tenantId,
        subscriptionId: activeSub.id,
        provider: 'razorpay',
        providerPaymentId: dto.razorpay_payment_id,
        providerSignature: dto.razorpay_signature,
        amountMinor: rzpAmount,
        currency: rzpPayment.currency ?? plan.currency ?? 'INR',
        status: 'PAID',
        paymentMethod: rzpPayment.method,
        paidAt: new Date(),
        metadata: {
          providerSubscriptionId: dto.razorpay_subscription_id,
          planKey: plan.key,
          planId: plan.id,
          billingInterval,
        },
      },
      tx,
    );

    // Auto-generate invoice with GST breakdown
    const gst = calculateGstBreakdown(rzpAmount, paidPayment.currency, false);
    const tenant = await tenantsRepo.findTenantById(tenantId);
    const generatedInv = await billingRepo.generateInvoiceNumber(new Date().getFullYear(), tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        tenantId,
        subscriptionId: activeSub.id,
        planId: plan.id,
        invoiceNumber: generatedInv.invoiceNumber,
        invoiceYear: generatedInv.year,
        invoiceSeq: generatedInv.seq,
        amountCents: gst.subtotalMinor,
        taxCents: gst.taxMinor,
        totalCents: rzpAmount,
        subtotalMinor: gst.subtotalMinor,
        taxBreakdown: gst.taxBreakdown,
        customerSnapshot: {
          name: tenant?.name ?? 'Workspace',
          email: activeSub.billingEmail ?? (tenant?.slug ? `${tenant.slug}@example.com` : ''),
        },
        currency: paidPayment.currency,
        status: 'PAID',
        paidAt: new Date(),
        billingPeriodStart: currentPeriodStart,
        billingPeriodEnd: currentPeriodEnd,
        lineItems: [
          {
            description: `${plan.name} Plan (${isAnnual ? 'Annual' : 'Monthly'})`,
            quantity: 1,
            unitPriceCents: gst.subtotalMinor,
            totalCents: gst.subtotalMinor,
          },
        ],
      })
      .returning();

    if (!invoice) {
      throw AppError.internal('Failed to generate invoice record');
    }

    // Log subscription event
    await tx.insert(subscriptionEvents).values({
      subscriptionId: activeSub.id,
      tenantId,
      type: 'PURCHASED',
      fromPlanId: prevPlanId,
      toPlanId: plan.id,
      actorType: 'USER',
      actorId: actorUserId,
      metadata: {
        subscriptionId: dto.razorpay_subscription_id,
        paymentId: dto.razorpay_payment_id,
        planKey: plan.key,
        billingInterval,
        invoiceId: invoice.id,
      },
    });

    return { sub: activeSub, payment: paidPayment, fromPlanId: prevPlanId };
  });

  // Post-transaction notifications and cache sync
  const oldPlan = fromPlanId ? await billingRepo.findPlanById(fromPlanId) : null;
  const oldPlanKey = oldPlan?.key ?? null;
  if (oldPlanKey !== plan.key) {
    await onPlanChanged(tenantId, oldPlanKey, plan.key);
  } else {
    await invalidateTenantBillingCache(tenantId);
  }

  emitToUser(actorUserId, 'billing:subscription_activated', {
    subscriptionId: dto.razorpay_subscription_id,
    paymentId: dto.razorpay_payment_id,
  });

  return {
    success: true,
    status: 'ACTIVE',
    paymentId: payment.id,
    subscriptionId: sub.id,
    planKey: plan.key,
    planName: plan.name,
  };
}

export async function listTenantPayments(tenantId: string, query?: ListPaymentsQueryDto) {
  return billingRepo.findPaymentsByTenantId(tenantId, query);
}

export async function listPlatformPayments(query?: ListPlatformPaymentsQueryDto) {
  return billingRepo.listPaymentsForPlatform(query);
}

export async function getPaymentById(id: string, tenantId?: string) {
  const payment = await billingRepo.findPaymentById(id);
  if (!payment) throw AppError.notFound('Payment not found');
  if (tenantId && payment.tenantId !== tenantId) {
    throw AppError.notFound('Payment not found');
  }
  return payment;
}

export async function issuePaymentRefund(
  actorStaffId: string,
  paymentId: string,
  dto: IssueRefundDto,
  requestId?: string,
) {
  // 1. Transaction with FOR UPDATE lock on the payment record
  const { payment, localRefund, isFullRefund, refundAmount } = await db.transaction(async (tx) => {
    const [lockedPayment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update')
      .limit(1);

    if (!lockedPayment) throw AppError.notFound('Payment not found');

    if (lockedPayment.status !== 'PAID' && lockedPayment.status !== 'PARTIALLY_REFUNDED') {
      throw AppError.badRequest(
        `Cannot refund a payment with status "${lockedPayment.status}". Only PAID or PARTIALLY_REFUNDED payments can be refunded.`,
      );
    }

    if (!lockedPayment.providerPaymentId) {
      throw AppError.badRequest('Payment does not have a gateway payment ID to refund');
    }

    const requestedAmount = dto.amountMinor ?? lockedPayment.amountMinor;
    if (requestedAmount <= 0) {
      throw AppError.badRequest('Refund amount must be greater than 0');
    }

    // 2. Sum existing active/pending refunds for this payment
    const existingRefunds = await billingRepo.findRefundsByPaymentId(lockedPayment.id, tx);
    const existingRefundedSum = existingRefunds
      .filter((r) => ['INITIATED', 'PROCESSED', 'PENDING'].includes(r.status))
      .reduce((acc, r) => acc + r.amountMinor, 0);

    const remainingRefundable = lockedPayment.amountMinor - existingRefundedSum;
    if (requestedAmount > remainingRefundable) {
      throw AppError.badRequest(
        `Refund amount (${requestedAmount}) exceeds remaining refundable balance (${remainingRefundable})`,
      );
    }

    // 3. Create local refund row with status PENDING first
    const createdRefund = await billingRepo.createRefund(
      {
        tenantId: lockedPayment.tenantId,
        paymentId: lockedPayment.id,
        provider: 'razorpay',
        amountMinor: requestedAmount,
        currency: lockedPayment.currency,
        status: 'PENDING',
        reason: dto.reason,
        requestedBy: actorStaffId,
      },
      tx,
    );

    const willBeFullRefund = existingRefundedSum + requestedAmount >= lockedPayment.amountMinor;

    return {
      payment: lockedPayment,
      localRefund: createdRefund,
      isFullRefund: willBeFullRefund,
      refundAmount: requestedAmount,
    };
  });

  // 4. Call payment gateway outside the row lock
  const receipt = `rfnd_${localRefund.id.replace(/-/g, '').slice(0, 16)}`;
  let rzpRefund: { id: string; status: string };
  try {
    rzpRefund = await razorpayGateway.createRazorpayRefund({
      paymentId: payment.providerPaymentId!,
      amountMinor: refundAmount,
      receipt,
      notes: {
        reason: dto.reason,
        refundedBy: actorStaffId,
        paymentId: payment.id,
        localRefundId: localRefund.id,
      },
    });
  } catch (err: unknown) {
    // Gateway failed: mark local refund as FAILED and rethrow
    await billingRepo.updateRefund(localRefund.id, {
      status: 'FAILED',
    });
    throw err;
  }

  // 5. Update local refund record with gateway details
  const isProcessed = rzpRefund.status === 'processed';
  const updatedRefund = await billingRepo.updateRefund(localRefund.id, {
    providerRefundId: rzpRefund.id,
    status: isProcessed ? 'PROCESSED' : 'INITIATED',
    processedAt: isProcessed ? new Date() : undefined,
  });

  // 6. Update payment status based on total refunds
  await billingRepo.updatePayment(payment.id, {
    status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  });

  // 7. Policy on full refund: downgrade workspace to FREE plan and log downgrade
  if (isFullRefund) {
    const freePlan = await billingRepo.findPlanByKey(DEFAULT_PLAN_KEY);
    const sub = await billingRepo.findTenantSubscription(payment.tenantId);
    if (freePlan && sub && sub.planId !== freePlan.id) {
      const oldPlan = await billingRepo.findPlanById(sub.planId);
      await billingRepo.updateSubscription(sub.id, {
        planId: freePlan.id,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
      await onPlanChanged(payment.tenantId, oldPlan?.key ?? null, freePlan.key);
      await invalidateTenantBillingCache(payment.tenantId);
    }

    await platformRepo.logPlatformAction({
      actorStaffId,
      action: 'payment.full_refund_downgrade',
      targetType: 'tenant',
      targetId: payment.tenantId,
      tenantId: payment.tenantId,
      metadata: {
        paymentId: payment.id,
        refundId: localRefund.id,
        amountMinor: refundAmount,
        downgradedTo: DEFAULT_PLAN_KEY,
      },
      requestId,
    });
  }

  // 8. Operator audit log for the refund
  await platformRepo.logPlatformAction({
    actorStaffId,
    action: 'payment.refunded',
    targetType: 'payment',
    targetId: payment.id,
    tenantId: payment.tenantId,
    metadata: {
      refundId: localRefund.id,
      amountMinor: refundAmount,
      reason: dto.reason,
      providerRefundId: rzpRefund.id,
      isFullRefund,
    },
    requestId,
  });

  return updatedRefund ?? localRefund;
}
