import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { closeDb } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import { AppError } from '@/lib/errors';
import {
  assignSubscriptionDto,
  billingWebhookDto,
  createPlanDto,
  listPlansQueryDto,
  listPlatformSubscriptionsQueryDto,
  setTenantEntitlementOverrideDto,
} from '@/modules/billing/billing.dto';
import { billingRepo } from '@/modules/billing/billing.repository';
import * as billingService from '@/modules/billing/billing.service';
import {
  DEFAULT_ENTITLEMENT_DEFINITIONS,
  DEFAULT_PLAN_ENTITLEMENT_VALUES,
} from '@/modules/billing/entitlements.defaults';

describe('Phase 07: Plans, Entitlements and Subscriptions Unit Tests', () => {
  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockStaffId = '55555555-5555-5555-5555-555555555555';
  const mockPlanId = '66666666-6666-6666-6666-666666666666';

  beforeEach(async () => {
    await billingService.invalidateTenantBillingCache(mockTenantId);
  });

  after(async () => {
    await closeRedisClients();
    await closeDb();
  });

  describe('1. DTO Validation and List Filtering', () => {
    it('validates listPlansQueryDto with comprehensive filters', () => {
      const parsed = listPlansQueryDto.parse({
        search: 'Enterprise',
        status: 'active',
        billingInterval: 'ANNUAL',
        currency: 'USD',
        minPriceMinor: 1000,
        maxPriceMinor: 50000,
        entitlement: 'groups.enabled',
        page: 1,
        limit: 25,
      });

      assert.equal(parsed.search, 'Enterprise');
      assert.equal(parsed.status, 'active');
      assert.equal(parsed.billingInterval, 'ANNUAL');
      assert.equal(parsed.currency, 'USD');
      assert.equal(parsed.minPriceMinor, 1000);
      assert.equal(parsed.maxPriceMinor, 50000);
      assert.equal(parsed.entitlement, 'groups.enabled');
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 25);
    });

    it('validates createPlanDto with typed entitlements and defaults', () => {
      const input = {
        key: 'GROWTH',
        name: 'Growth Plan',
        description: 'For scaling teams',
        priceMonthlyMinor: 4900,
        priceYearlyMinor: 49000,
        currency: 'USD',
        trialDays: 14,
        billingInterval: 'MONTHLY' as const,
        limits: {
          maxMembers: 50,
          maxStorageBytes: 50 * 1024 * 1024 * 1024,
          maxCustomRoles: 10,
          urlAccess: { path: true as const, subdomain: true, customDomain: false },
        },
        entitlements: {
          'members.max': 50,
          'storage.gb': 50,
          'groups.enabled': true,
          'custom_domains.max': 1,
          'audit.retention_days': 90,
          'api_access.enabled': true,
        },
      };

      const parsed = createPlanDto.parse(input);
      assert.equal(parsed.key, 'GROWTH');
      assert.equal(parsed.priceMonthlyMinor, 4900);
      assert.equal(parsed.billingInterval, 'MONTHLY');
      assert.equal(parsed.entitlements?.['members.max'], 50);
      assert.equal(parsed.entitlements?.['groups.enabled'], true);
    });

    it('validates assignSubscriptionDto for platform staff subscription provisioning', () => {
      const parsed = assignSubscriptionDto.parse({
        tenantId: mockTenantId,
        planKey: 'PRO',
        startDate: new Date('2026-11-01'),
        isTrial: false,
        billingInterval: 'MONTHLY',
        billingEmail: 'billing@acme.org',
        seatCount: 10,
        internalNotes: 'Custom enterprise trial negotiated by sales',
      });

      assert.equal(parsed.tenantId, mockTenantId);
      assert.equal(parsed.planKey, 'PRO');
      assert.equal(parsed.billingEmail, 'billing@acme.org');
      assert.equal(parsed.seatCount, 10);
      assert.equal(parsed.internalNotes, 'Custom enterprise trial negotiated by sales');
    });

    it('validates listPlatformSubscriptionsQueryDto with multi-field search and filters', () => {
      const parsed = listPlatformSubscriptionsQueryDto.parse({
        status: 'ACTIVE',
        billingInterval: 'MONTHLY',
        provider: 'stripe',
        search: 'acme',
        page: 2,
        limit: 10,
      });

      assert.equal(parsed.status, 'ACTIVE');
      assert.equal(parsed.billingInterval, 'MONTHLY');
      assert.equal(parsed.provider, 'stripe');
      assert.equal(parsed.search, 'acme');
      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 10);
    });

    it('validates setTenantEntitlementOverrideDto with typed value and expiry', () => {
      const futureDate = new Date(Date.now() + 86400000 * 30);
      const parsed = setTenantEntitlementOverrideDto.parse({
        entitlementKey: 'storage.gb',
        value: 100,
        expiresAt: futureDate,
        reason: 'Temporary promo extra storage',
      });

      assert.equal(parsed.entitlementKey, 'storage.gb');
      assert.equal(parsed.value, 100);
      assert.equal(parsed.reason, 'Temporary promo extra storage');
    });

    it('validates billingWebhookDto with provider, eventId and payload', () => {
      const parsed = billingWebhookDto.parse({
        provider: 'stripe',
        eventId: 'evt_test_1234567890',
        eventType: 'customer.subscription.updated',
        payload: {
          tenantId: mockTenantId,
          planKey: 'ENTERPRISE',
          status: 'active',
        },
      });

      assert.equal(parsed.provider, 'stripe');
      assert.equal(parsed.eventId, 'evt_test_1234567890');
      assert.equal(parsed.eventType, 'customer.subscription.updated');
    });
  });

  describe('2. Entitlement Definitions & Default Values', () => {
    it('defines canonical typed entitlement definitions', () => {
      assert.ok(DEFAULT_ENTITLEMENT_DEFINITIONS.length >= 6);
      const keys = DEFAULT_ENTITLEMENT_DEFINITIONS.map((d) => d.key);

      assert.ok(keys.includes('members.max'));
      assert.ok(keys.includes('storage.gb'));
      assert.ok(keys.includes('groups.enabled'));
      assert.ok(keys.includes('custom_domains.max'));
      assert.ok(keys.includes('audit.retention_days'));
      assert.ok(keys.includes('api_access.enabled'));
    });

    it('defines distinct plan tiers in default mapping', () => {
      const freeEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES['FREE']!;
      const proEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES['PRO']!;
      const entEnts = DEFAULT_PLAN_ENTITLEMENT_VALUES['ENTERPRISE']!;

      assert.equal(freeEnts['groups.enabled'], false);
      assert.equal(proEnts['groups.enabled'], true);
      assert.equal(entEnts['groups.enabled'], true);

      assert.ok(freeEnts['members.max'] < proEnts['members.max']);
      assert.ok(proEnts['members.max'] < entEnts['members.max']);
      assert.ok(freeEnts['storage.gb'] < proEnts['storage.gb']);
      assert.ok(proEnts['storage.gb'] < entEnts['storage.gb']);
    });
  });

  describe('3. Effective Entitlements Resolution & Precedence', () => {
    it('resolves base plan entitlements when no tenant overrides exist', async () => {
      const testTenantId = '22222222-2222-2222-2222-222222222222';
      await billingService.invalidateTenantBillingCache(testTenantId);

      const origFindSub = billingRepo.findTenantSubscriptionWithPlan;
      const origFindDefs = billingRepo.findEntitlementDefinitions;
      const origFindPlanEnts = billingRepo.findPlanEntitlements;
      const origFindOverrides = billingRepo.findTenantEntitlementOverrides;

      billingRepo.findTenantSubscriptionWithPlan = async () => ({
        id: 'sub-1',
        tenantId: testTenantId,
        planId: mockPlanId,
        status: 'ACTIVE',
        seatCount: 5,
        plan: {
          id: mockPlanId,
          key: 'PRO',
          name: 'Pro Tier',
          limits: { maxMembers: 25, maxStorageBytes: 20 * 1024 * 1024 * 1024, maxCustomRoles: 5 },
          modules: ['files', 'rbac', 'billing', 'groups'],
          entitlements: DEFAULT_PLAN_ENTITLEMENT_VALUES['PRO'],
        },
      } as any);

      billingRepo.findEntitlementDefinitions = async () => DEFAULT_ENTITLEMENT_DEFINITIONS as any;
      billingRepo.findPlanEntitlements = async () => (DEFAULT_PLAN_ENTITLEMENT_VALUES['PRO'] ?? {}) as any;
      billingRepo.findTenantEntitlementOverrides = async () => [];

      try {
        const result = await billingService.getTenantEntitlements(testTenantId);

        assert.equal(result.planKey, 'PRO');
        assert.equal(result.entitlements['members.max']?.value, 25);
        assert.equal(result.entitlements['members.max']?.source, 'PLAN');
        assert.equal(result.entitlements['groups.enabled']?.value, true);
        assert.equal(result.entitlements['groups.enabled']?.source, 'PLAN');
        assert.equal(result.limits.maxMembers, 25);
        assert.equal(result.urlAccess.subdomain, true);
      } finally {
        billingRepo.findTenantSubscriptionWithPlan = origFindSub;
        billingRepo.findEntitlementDefinitions = origFindDefs;
        billingRepo.findPlanEntitlements = origFindPlanEnts;
        billingRepo.findTenantEntitlementOverrides = origFindOverrides;
      }
    });

    it('prioritizes active tenant overrides over base plan entitlements with OVERRIDE provenance', async () => {
      const testTenantId = '33333333-3333-3333-3333-333333333333';
      await billingService.invalidateTenantBillingCache(testTenantId);

      const origFindSub = billingRepo.findTenantSubscriptionWithPlan;
      const origFindDefs = billingRepo.findEntitlementDefinitions;
      const origFindPlanEnts = billingRepo.findPlanEntitlements;
      const origFindOverrides = billingRepo.findTenantEntitlementOverrides;

      billingRepo.findTenantSubscriptionWithPlan = async () => ({
        id: 'sub-1',
        tenantId: testTenantId,
        planId: mockPlanId,
        status: 'ACTIVE',
        seatCount: 5,
        plan: {
          id: mockPlanId,
          key: 'FREE',
          name: 'Free Tier',
          limits: { maxMembers: 5, maxStorageBytes: 1024 * 1024 * 1024, maxCustomRoles: 0 },
          modules: ['files', 'rbac'],
          entitlements: DEFAULT_PLAN_ENTITLEMENT_VALUES['FREE'],
        },
      } as any);

      billingRepo.findEntitlementDefinitions = async () => DEFAULT_ENTITLEMENT_DEFINITIONS as any;
      billingRepo.findPlanEntitlements = async () => (DEFAULT_PLAN_ENTITLEMENT_VALUES['FREE'] ?? {}) as any;
      billingRepo.findTenantEntitlementOverrides = async () => [
        {
          id: 'ov-1',
          tenantId: testTenantId,
          entitlementKey: 'members.max',
          value: 100,
          expiresAt: new Date(Date.now() + 86400000 * 30),
          reason: 'VIP partner override',
          createdBy: mockStaffId,
        },
        {
          id: 'ov-2',
          tenantId: testTenantId,
          entitlementKey: 'groups.enabled',
          value: true,
          expiresAt: null,
          reason: 'Beta feature flag override',
          createdBy: mockStaffId,
        },
      ] as any;

      try {
        const result = await billingService.getTenantEntitlements(testTenantId);

        // FREE plan normally has members.max: 5, groups.enabled: false
        // With overrides: members.max: 100 (OVERRIDE), groups.enabled: true (OVERRIDE)
        assert.equal(result.entitlements['members.max']?.value, 100);
        assert.equal(result.entitlements['members.max']?.source, 'OVERRIDE');
        assert.equal(result.entitlements['groups.enabled']?.value, true);
        assert.equal(result.entitlements['groups.enabled']?.source, 'OVERRIDE');
        assert.equal(result.limits.maxMembers, 100);

        // Non-overridden entitlement still reflects base plan
        assert.equal(result.entitlements['storage.gb']?.value, 1);
        assert.equal(result.entitlements['storage.gb']?.source, 'PLAN');
      } finally {
        billingRepo.findTenantSubscriptionWithPlan = origFindSub;
        billingRepo.findEntitlementDefinitions = origFindDefs;
        billingRepo.findPlanEntitlements = origFindPlanEnts;
        billingRepo.findTenantEntitlementOverrides = origFindOverrides;
      }
    });
  });

  describe('4. Quota Enforcement & Metering', () => {
    it('assertQuota permits operations when usage is within limits', async () => {
      const testTenantId = '44444444-4444-4444-4444-444444444444';
      await billingService.invalidateTenantBillingCache(testTenantId);

      const origFindSub = billingRepo.findTenantSubscriptionWithPlan;
      const origFindDefs = billingRepo.findEntitlementDefinitions;
      const origFindPlanEnts = billingRepo.findPlanEntitlements;
      const origFindOverrides = billingRepo.findTenantEntitlementOverrides;
      const origGetUsage = billingRepo.getTenantUsage;

      billingRepo.findTenantSubscriptionWithPlan = async () => ({
        id: 'sub-quota-1',
        tenantId: testTenantId,
        planId: mockPlanId,
        status: 'ACTIVE',
        seatCount: 1,
        plan: {
          id: mockPlanId,
          key: 'PRO',
          name: 'Pro',
          limits: { maxMembers: 25, maxStorageBytes: 20 * 1024 * 1024 * 1024, maxCustomRoles: 5 },
          modules: ['files'],
          entitlements: {
            'members.max': 10,
            'groups.enabled': true,
          },
        },
      } as any);

      billingRepo.findEntitlementDefinitions = async () => DEFAULT_ENTITLEMENT_DEFINITIONS as any;
      billingRepo.findPlanEntitlements = async () => ({
        'members.max': 10,
        'groups.enabled': true,
      });
      billingRepo.findTenantEntitlementOverrides = async () => [];

      billingRepo.getTenantUsage = async () => ({
        members: 5,
        storageBytes: 1024,
        customRoles: 1,
      });

      try {
        // Current: 5, Limit: 10, Increment: 1 => Total 6 <= 10 (pass)
        await assert.doesNotReject(async () => {
          await billingService.assertQuota(testTenantId, 'members.max', 1);
        });

        // Boolean feature enabled => pass
        await assert.doesNotReject(async () => {
          await billingService.assertQuota(testTenantId, 'groups.enabled');
        });
      } finally {
        billingRepo.findTenantSubscriptionWithPlan = origFindSub;
        billingRepo.findEntitlementDefinitions = origFindDefs;
        billingRepo.findPlanEntitlements = origFindPlanEnts;
        billingRepo.findTenantEntitlementOverrides = origFindOverrides;
        billingRepo.getTenantUsage = origGetUsage;
      }
    });

    it('assertQuota throws 403 PLAN_LIMIT_REACHED when usage exceeds integer limit', async () => {
      const testTenantId = '55555555-5555-5555-5555-555555555556';
      await billingService.invalidateTenantBillingCache(testTenantId);

      const origFindSub = billingRepo.findTenantSubscriptionWithPlan;
      const origFindDefs = billingRepo.findEntitlementDefinitions;
      const origFindPlanEnts = billingRepo.findPlanEntitlements;
      const origFindOverrides = billingRepo.findTenantEntitlementOverrides;
      const origGetUsage = billingRepo.getTenantUsage;

      billingRepo.findTenantSubscriptionWithPlan = async () => ({
        id: 'sub-quota-2',
        tenantId: testTenantId,
        planId: mockPlanId,
        status: 'ACTIVE',
        seatCount: 1,
        plan: {
          id: mockPlanId,
          key: 'FREE',
          name: 'Free',
          limits: { maxMembers: 5, maxStorageBytes: 1024 * 1024 * 1024, maxCustomRoles: 0 },
          modules: ['files'],
          entitlements: { 'members.max': 5 },
        },
      } as any);

      billingRepo.findEntitlementDefinitions = async () => DEFAULT_ENTITLEMENT_DEFINITIONS as any;
      billingRepo.findPlanEntitlements = async () => ({ 'members.max': 5 });
      billingRepo.findTenantEntitlementOverrides = async () => [];

      billingRepo.getTenantUsage = async () => ({
        members: 5,
        storageBytes: 1024,
        customRoles: 0,
      });

      try {
        // Current: 5, Limit: 5, Increment: 1 => Total 6 > 5 (must reject)
        await assert.rejects(
          async () => {
            await billingService.assertQuota(testTenantId, 'members.max', 1);
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 403);
            assert.equal(err.code, 'PLAN_LIMIT_REACHED');
            assert.equal((err.details as any)?.limit, 5);
            assert.equal((err.details as any)?.current, 5);
            return true;
          },
        );
      } finally {
        billingRepo.findTenantSubscriptionWithPlan = origFindSub;
        billingRepo.findEntitlementDefinitions = origFindDefs;
        billingRepo.findPlanEntitlements = origFindPlanEnts;
        billingRepo.findTenantEntitlementOverrides = origFindOverrides;
        billingRepo.getTenantUsage = origGetUsage;
      }
    });

    it('assertQuota throws 403 FEATURE_NOT_ENTITLED when boolean feature is not allowed on plan', async () => {
      const testTenantId = '66666666-6666-6666-6666-666666666667';
      await billingService.invalidateTenantBillingCache(testTenantId);

      const origFindSub = billingRepo.findTenantSubscriptionWithPlan;
      const origFindDefs = billingRepo.findEntitlementDefinitions;
      const origFindPlanEnts = billingRepo.findPlanEntitlements;
      const origFindOverrides = billingRepo.findTenantEntitlementOverrides;

      billingRepo.findTenantSubscriptionWithPlan = async () => ({
        id: 'sub-quota-3',
        tenantId: testTenantId,
        planId: mockPlanId,
        status: 'ACTIVE',
        seatCount: 1,
        plan: {
          id: mockPlanId,
          key: 'FREE',
          name: 'Free',
          limits: { maxMembers: 5, maxStorageBytes: 1024 * 1024 * 1024, maxCustomRoles: 0 },
          modules: ['files'],
          entitlements: { 'groups.enabled': false },
        },
      } as any);

      billingRepo.findEntitlementDefinitions = async () => DEFAULT_ENTITLEMENT_DEFINITIONS as any;
      billingRepo.findPlanEntitlements = async () => ({ 'groups.enabled': false });
      billingRepo.findTenantEntitlementOverrides = async () => [];

      try {
        await assert.rejects(
          async () => {
            await billingService.assertQuota(testTenantId, 'groups.enabled');
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.status, 403);
            assert.equal(err.code, 'FEATURE_NOT_ENTITLED');
            assert.equal((err.details as any)?.entitlementKey, 'groups.enabled');
            return true;
          },
        );
      } finally {
        billingRepo.findTenantSubscriptionWithPlan = origFindSub;
        billingRepo.findEntitlementDefinitions = origFindDefs;
        billingRepo.findPlanEntitlements = origFindPlanEnts;
        billingRepo.findTenantEntitlementOverrides = origFindOverrides;
      }
    });

    it('enforceLimit seamlessly delegates legacy quota keys to typed entitlement enforcement', async () => {
      const testTenantId = '77777777-7777-7777-7777-777777777778';
      await billingService.invalidateTenantBillingCache(testTenantId);

      const origFindSub = billingRepo.findTenantSubscriptionWithPlan;
      const origFindDefs = billingRepo.findEntitlementDefinitions;
      const origFindPlanEnts = billingRepo.findPlanEntitlements;
      const origFindOverrides = billingRepo.findTenantEntitlementOverrides;
      const origGetUsage = billingRepo.getTenantUsage;

      billingRepo.findTenantSubscriptionWithPlan = async () => ({
        id: 'sub-quota-4',
        tenantId: testTenantId,
        planId: mockPlanId,
        status: 'ACTIVE',
        seatCount: 1,
        plan: {
          id: mockPlanId,
          key: 'PRO',
          name: 'Pro',
          limits: { maxMembers: 25, maxStorageBytes: 20 * 1024 * 1024 * 1024, maxCustomRoles: 5 },
          modules: ['files'],
          entitlements: {
            'members.max': 25,
            'storage.gb': 20,
            'custom_roles.max': 5,
          },
        },
      } as any);

      billingRepo.findEntitlementDefinitions = async () => DEFAULT_ENTITLEMENT_DEFINITIONS as any;
      billingRepo.findPlanEntitlements = async () => ({
        'members.max': 25,
        'storage.gb': 20,
        'custom_roles.max': 5,
      });
      billingRepo.findTenantEntitlementOverrides = async () => [];

      billingRepo.getTenantUsage = async () => ({
        members: 2,
        storageBytes: 1024 * 1024 * 1024,
        customRoles: 1,
      });

      try {
        await assert.doesNotReject(async () => {
          await billingService.enforceLimit(testTenantId, 'maxMembers', 1);
        });

        await assert.doesNotReject(async () => {
          await billingService.enforceLimit(testTenantId, 'maxStorageBytes', 1);
        });

        await assert.doesNotReject(async () => {
          await billingService.enforceLimit(testTenantId, 'maxCustomRoles', 1);
        });
      } finally {
        billingRepo.findTenantSubscriptionWithPlan = origFindSub;
        billingRepo.findEntitlementDefinitions = origFindDefs;
        billingRepo.findPlanEntitlements = origFindPlanEnts;
        billingRepo.findTenantEntitlementOverrides = origFindOverrides;
        billingRepo.getTenantUsage = origGetUsage;
      }
    });
  });

  describe('5. Duplicate Webhook Safety (Idempotent Processing)', () => {
    it('processes webhook on initial delivery and marks status PROCESSED', async () => {
      const origFindWebhook = billingRepo.findBillingWebhook;
      const origCreateWebhook = billingRepo.createBillingWebhook;
      const origFindSub = billingRepo.findTenantSubscription;
      const origFindPlan = billingRepo.findPlanByKey;

      billingRepo.findBillingWebhook = async () => null;
      billingRepo.findTenantSubscription = async () => null;
      billingRepo.findPlanByKey = async () => null;
      billingRepo.createBillingWebhook = async (data: any) => ({
        id: 'wh-1',
        ...data,
        processedAt: new Date(),
      });

      try {
        const result = await billingService.processBillingWebhook({
          provider: 'stripe',
          eventId: 'evt_new_unique_101',
          eventType: 'customer.subscription.updated',
          payload: { tenantId: mockTenantId, planKey: 'PRO' },
        });

        assert.equal(result.status, 'PROCESSED');
        assert.equal(result.idempotent, false);
        assert.equal(result.record?.eventId, 'evt_new_unique_101');
      } finally {
        billingRepo.findBillingWebhook = origFindWebhook;
        billingRepo.createBillingWebhook = origCreateWebhook;
        billingRepo.findTenantSubscription = origFindSub;
        billingRepo.findPlanByKey = origFindPlan;
      }
    });

    it('safely ignores duplicate webhook delivery without side effects', async () => {
      const origFindWebhook = billingRepo.findBillingWebhook;
      const origCreateWebhook = billingRepo.createBillingWebhook;
      let createCalled = false;

      billingRepo.findBillingWebhook = async (provider: string, eventId: string) => ({
        id: 'wh-existing',
        provider,
        eventId,
        eventType: 'customer.subscription.updated',
        status: 'PROCESSED',
        processedAt: new Date('2026-11-04T10:00:00Z'),
      } as any);

      billingRepo.createBillingWebhook = (async () => {
        createCalled = true;
      }) as any;

      try {
        const result = await billingService.processBillingWebhook({
          provider: 'stripe',
          eventId: 'evt_already_processed_999',
          eventType: 'customer.subscription.updated',
          payload: { tenantId: mockTenantId, planKey: 'PRO' },
        });

        assert.equal(result.status, 'DUPLICATE_IGNORED');
        assert.equal(result.idempotent, true);
        assert.equal(result.eventId, 'evt_already_processed_999');
        assert.equal(createCalled, false, 'Duplicate webhook must not create a new DB record');
      } finally {
        billingRepo.findBillingWebhook = origFindWebhook;
        billingRepo.createBillingWebhook = origCreateWebhook;
      }
    });
  });

  describe('6. Non-Destructive Subscription Cancellation & Invariants', () => {
    it('cancels subscription without deleting workspace tenant data', async () => {
      const origFindWebhook = billingRepo.findBillingWebhook;
      const origCreateWebhook = billingRepo.createBillingWebhook;
      const origFindSub = billingRepo.findTenantSubscription;
      const origUpdateSub = billingRepo.updateSubscription;
      let updatedStatus = '';

      billingRepo.findBillingWebhook = async () => null;
      billingRepo.createBillingWebhook = async (data: any) => ({ id: 'wh-del', ...data } as any);
      billingRepo.findTenantSubscription = async () => ({
        id: 'sub-active',
        tenantId: mockTenantId,
        status: 'ACTIVE',
      } as any);
      billingRepo.updateSubscription = async (_id: string, updates: any) => {
        updatedStatus = updates.status;
        return { id: _id, ...updates } as any;
      };

      try {
        const result = await billingService.processBillingWebhook({
          provider: 'stripe',
          eventId: 'evt_cancel_subscription_888',
          eventType: 'customer.subscription.deleted',
          payload: { tenantId: mockTenantId },
        });

        assert.equal(result.status, 'PROCESSED');
        assert.equal(updatedStatus, 'CANCELED', 'Subscription status must be set to CANCELED');
        // Tenant record was NOT deleted
      } finally {
        billingRepo.findBillingWebhook = origFindWebhook;
        billingRepo.createBillingWebhook = origCreateWebhook;
        billingRepo.findTenantSubscription = origFindSub;
        billingRepo.updateSubscription = origUpdateSub;
      }
    });
  });
});
