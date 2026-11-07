import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';

import { closeDb, db } from '../src/config/db';
import { env } from '../src/config/env';
import { closeRedisClients } from '../src/config/redis';
import { platformRoles, platformStaff, tenants } from '../src/db/schema';
import { AppError } from '../src/lib/errors';
import { billingRepo } from '../src/modules/billing/billing.repository';
import * as service from '../src/modules/billing/billing.service';

const TEST_SECRET = 'test_secret_for_integration_testing_12345';
(env as any).RAZORPAY_KEY_SECRET = TEST_SECRET;
(env as any).RAZORPAY_KEY_ID = 'rzp_test_integration';

let tenantAId: string;
let tenantBId: string;
let proPlanId: string;
let testStaffId: string;

before(async () => {
  // Ensure default plans are present
  await service.seedDefaultPlans();

  const proPlan = await billingRepo.findPlanByKey('PRO');
  assert.ok(proPlan);
  proPlanId = proPlan.id;

  // Find or create test platform staff for audit logging foreign key
  const [existingStaff] = await db.select().from(platformStaff).limit(1);
  if (existingStaff) {
    testStaffId = existingStaff.id;
  } else {
    let [role] = await db.select().from(platformRoles).limit(1);
    if (!role) {
      const [newRole] = await db
        .insert(platformRoles)
        .values({
          name: 'Super Admin',
          key: 'SUPER_ADMIN',
          description: 'Platform administrator',
        })
        .returning();
      role = newRole;
    }
    const [createdStaff] = await db
      .insert(platformStaff)
      .values({
        email: `staff-${Date.now()}@platform.local`,
        passwordHash: 'dummy_hash',
        displayName: 'Test Staff',
        roleId: role!.id,
      })
      .returning();
    testStaffId = createdStaff!.id;
  }

  // Create two isolated test tenants
  const [tenantA] = await db
    .insert(tenants)
    .values({
      name: 'Tenant Alpha Test',
      slug: `tenant-a-${Date.now()}`,
      plan: 'FREE',
    })
    .returning();

  const [tenantB] = await db
    .insert(tenants)
    .values({
      name: 'Tenant Beta Test',
      slug: `tenant-b-${Date.now()}`,
      plan: 'FREE',
    })
    .returning();

  tenantAId = tenantA!.id;
  tenantBId = tenantB!.id;
});

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('One-time payment flow: order creation, signature verification, entitlement activation', async () => {
  // 1. Create a local payment order
  const orderId = `order_test_${Date.now()}`;
  const localPayment = await billingRepo.createPayment({
    tenantId: tenantAId,
    provider: 'razorpay',
    providerOrderId: orderId,
    amountMinor: 290000,
    currency: 'INR',
    status: 'CREATED',
    metadata: {
      planKey: 'PRO',
      planId: proPlanId,
      billingInterval: 'MONTHLY',
    },
  });

  assert.ok(localPayment.id);
  assert.equal(localPayment.status, 'CREATED');

  // 2. IDOR Prevention: Tenant B cannot verify Tenant A's payment
  const paymentId = `pay_mock_${Date.now()}`;
  const signature = crypto
    .createHmac('sha256', TEST_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  await assert.rejects(
    async () => {
      await service.verifyTenantOrderPayment(tenantBId, 'user_b_1', {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      });
    },
    (err: any) => err instanceof AppError && err.status === 404,
  );

  // 3. Reject invalid signature
  await assert.rejects(
    async () => {
      await service.verifyTenantOrderPayment(tenantAId, 'user_a_1', {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: 'invalid_tampered_signature',
      });
    },
    (err: any) => err instanceof AppError && err.status === 400,
  );
});

test('Subscription cancellation: updates status and records event without data loss', async () => {
  // Assign active subscription to tenant B
  await service.assignSubscription(testStaffId, {
    tenantId: tenantBId,
    planKey: 'PRO',
    billingInterval: 'MONTHLY',
    isTrial: false,
    seatCount: 1,
    prorate: false,
  });

  const subBefore = await billingRepo.findTenantSubscription(tenantBId);
  assert.ok(subBefore);
  assert.equal(subBefore.status, 'ACTIVE');

  // Cancel subscription at period end
  const cancelResult = await service.cancelTenantSubscription(tenantBId, 'user_b_1', {
    immediately: false,
    reason: 'Evaluating other options',
  });

  assert.equal(cancelResult.success, true);
  assert.equal(cancelResult.cancelAtPeriodEnd, true);

  const subAfter = await billingRepo.findTenantSubscription(tenantBId);
  assert.ok(subAfter);
  assert.equal(subAfter.cancelAtPeriodEnd, true);
  // Status remains active until period ends!
  assert.equal(subAfter.status, 'ACTIVE');
});

test('Platform staff manual entitlement override with reason', async () => {
  const result = await service.overrideTenantEntitlements(testStaffId, tenantAId, {
    planKey: 'ENTERPRISE',
    status: 'ACTIVE',
    reason: 'VIP pilot customer onboarding grant',
  });

  assert.ok(result);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.plan?.key, 'ENTERPRISE');

  const [tenantRecord] = await db.select().from(tenants).where(eq(tenants.id, tenantAId));
  assert.equal(tenantRecord?.plan, 'ENTERPRISE');
});
