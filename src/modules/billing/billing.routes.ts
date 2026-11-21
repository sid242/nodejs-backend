import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { billingPublicLimiter, billingWebhookLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
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
  ['/webhooks', '/webhooks/razorpay'],
  billingWebhookLimiter,
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
// 5. Platform Staff Payments & Refunds
// ==========================================
router.get(
  '/platform/payments',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ query: dto.listPlatformPaymentsQueryDto }),
  controller.listPlatformPayments,
);

router.get(
  '/platform/payments/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ params: dto.paymentIdParamDto }),
  controller.getPlatformPaymentById,
);

router.post(
  '/platform/payments/:id/refund',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.paymentIdParamDto, body: dto.issueRefundDto }),
  controller.issuePaymentRefund,
);

router.post(
  '/platform/tenants/:id/override',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.tenantSubscriptionParamDto, body: dto.overrideEntitlementsDto }),
  controller.overrideTenantEntitlements,
);

// ==========================================
// 6. Tenant Subscription & Billing
// ==========================================
router.get(
  '/subscription',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  controller.getTenantBillingOverview,
);

router.get(
  '/entitlements',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  controller.getTenantEntitlements,
);

router.post(
  ['/subscription/change', '/subscription/change-request'],
  requireAuth,
  requireTenant,
  requirePermission('billing:manage'),
  validate({ body: dto.subscriptionChangeRequestDto }),
  controller.requestSubscriptionChange,
);

router.post(
  '/checkout/order',
  requireAuth,
  requireTenant,
  requirePermission('billing:manage'),
  validate({ body: dto.checkoutOrderDto }),
  controller.createCheckoutOrder,
);

router.post(
  '/checkout/verify',
  requireAuth,
  requireTenant,
  requirePermission('billing:manage'),
  validate({ body: dto.verifyOrderPaymentDto }),
  controller.verifyOrderPayment,
);

router.post(
  '/subscriptions',
  requireAuth,
  requireTenant,
  requirePermission('billing:manage'),
  validate({ body: dto.checkoutSubscriptionDto }),
  controller.createSubscriptionCheckout,
);

router.post(
  '/subscriptions/verify',
  requireAuth,
  requireTenant,
  requirePermission('billing:manage'),
  validate({ body: dto.verifySubscriptionPaymentDto }),
  controller.verifySubscriptionPayment,
);

router.post(
  '/subscriptions/cancel',
  requireAuth,
  requireTenant,
  requirePermission('billing:manage'),
  validate({ body: dto.cancelSubscriptionDto }),
  controller.cancelSubscription,
);

router.get(
  '/payments',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  validate({ query: dto.listPaymentsQueryDto }),
  controller.listTenantPayments,
);

router.get(
  '/payments/:id',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  validate({ params: dto.paymentIdParamDto }),
  controller.getTenantPaymentById,
);

router.get(
  '/invoices',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  validate({ query: dto.listInvoicesQueryDto }),
  controller.getTenantInvoices,
);

router.get(
  '/invoices/:invoiceId',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  controller.getTenantInvoiceById,
);

router.get(
  '/invoices/:invoiceId/download',
  requireAuth,
  requireTenant,
  requirePermission('billing:read'),
  controller.downloadTenantInvoice,
);

// ==========================================
// 7. Public Pricing & Plans Catalog
// ==========================================
router.get('/', billingPublicLimiter, controller.listPublicPlans);
router.get('/:id', billingPublicLimiter, validate({ params: dto.planIdParamDto }), controller.getPlanById);

export default router;
