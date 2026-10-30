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
// 1. Platform Staff Plans Catalog
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
// 2. Platform Staff Tenant Subscriptions
// ==========================================
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

// ==========================================
// 3. Platform Staff Invoices Management
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
// 4. Tenant Subscription & Billing
// ==========================================
router.get(
  '/subscription',
  requireAuth,
  requireTenant,
  controller.getTenantBillingOverview,
);

router.post(
  ['/subscription/change', '/subscription/change-request'],
  requireAuth,
  requireTenant,
  validate({ body: dto.subscriptionChangeRequestDto }),
  controller.requestSubscriptionChange,
);

// ==========================================
// 5. Public Pricing & Plans Catalog
// ==========================================
router.get('/', controller.listPublicPlans);
router.get('/:id', validate({ params: dto.planIdParamDto }), controller.getPlanById);

export default router;
