import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './billing.controller';
import * as dto from './billing.dto';

const router: Router = Router();

// ==========================================
// 1. Webhooks (External Provider Ingress)
// ==========================================
router.post(
  '/webhooks',
  validate({ body: dto.billingWebhookDto }),
  controller.handleBillingWebhook,
);

// ==========================================
// 2. Platform Staff Plans Catalog
// ==========================================
router.get(
  ['/platform', '/platform/plans'],
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ query: dto.listPlansQueryDto }),
  controller.listPlatformPlans,
);

router.post(
  ['/platform', '/platform/plans'],
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ body: dto.createPlanDto }),
  controller.createPlan,
);

router.patch(
  ['/platform/:id', '/platform/plans/:id'],
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.planIdParamDto, body: dto.updatePlanDto }),
  controller.updatePlan,
);

// ==========================================
// 3. Platform Staff Subscriptions & Overrides
// ==========================================
router.get(
  '/platform/subscriptions',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ query: dto.listPlatformSubscriptionsQueryDto }),
  controller.listPlatformSubscriptions,
);

router.post(
  '/platform/subscriptions/assign',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ body: dto.assignSubscriptionDto }),
  controller.assignSubscription,
);

router.get(
  '/platform/tenants/:id/subscription',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ params: dto.tenantSubscriptionParamDto }),
  controller.getPlatformTenantSubscription,
);

router.put(
  '/platform/tenants/:id/subscription',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.tenantSubscriptionParamDto, body: dto.updateSubscriptionDto }),
  controller.updatePlatformTenantSubscription,
);

router.get(
  '/platform/entitlements',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  controller.listEntitlementDefinitions,
);

router.post(
  '/platform/tenants/:id/entitlements/override',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.tenantSubscriptionParamDto, body: dto.setTenantEntitlementOverrideDto }),
  controller.setTenantOverride,
);

router.delete(
  '/platform/tenants/:id/entitlements/override/:key',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.tenantSubscriptionParamDto }),
  controller.removeTenantOverride,
);

// ==========================================
// 4. Platform Staff Invoices Management
// ==========================================
router.get(
  '/platform/invoices',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ query: dto.listPlatformInvoicesQueryDto }),
  controller.listPlatformInvoices,
);

router.get(
  '/platform/invoices/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ params: dto.invoiceIdParamDto }),
  controller.getPlatformInvoiceById,
);

router.post(
  '/platform/invoices',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ body: dto.createInvoiceDto }),
  controller.createPlatformInvoice,
);

router.patch(
  '/platform/invoices/:id/status',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.invoiceIdParamDto, body: dto.updateInvoiceStatusDto }),
  controller.updateInvoiceStatus,
);

// ==========================================
// 5. Tenant Subscription & Billing
// ==========================================
router.get(
  '/subscription',
  requireAuth,
  requireTenant,
  controller.getTenantBillingOverview,
);

router.get(
  '/entitlements',
  requireAuth,
  requireTenant,
  controller.getTenantEntitlements,
);

router.post(
  ['/subscription/change', '/subscription/change-request'],
  requireAuth,
  requireTenant,
  validate({ body: dto.subscriptionChangeRequestDto }),
  controller.requestSubscriptionChange,
);

router.get(
  '/invoices',
  requireAuth,
  requireTenant,
  validate({ query: dto.listInvoicesQueryDto }),
  controller.getTenantInvoices,
);

router.get(
  '/invoices/:invoiceId',
  requireAuth,
  requireTenant,
  controller.getTenantInvoiceById,
);

// ==========================================
// 6. Public Pricing & Plans Catalog
// ==========================================
router.get('/', controller.listPublicPlans);
router.get('/:id', validate({ params: dto.planIdParamDto }), controller.getPlanById);

export default router;
