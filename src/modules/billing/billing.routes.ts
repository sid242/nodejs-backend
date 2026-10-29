import { Router } from 'express';

import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './billing.controller';
import * as dto from './billing.dto';

const router: Router = Router();

// ==========================================
// 1. Public Pricing & Plans Catalog
// ==========================================
router.get('/', controller.listPublicPlans);
router.get('/:id', validate({ params: dto.planIdParamDto }), controller.getPlanById);

// ==========================================
// 2. Platform Staff Plans Catalog
// ==========================================
router.get(
  '/platform/plans',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ query: dto.listPlansQueryDto }),
  controller.listPlatformPlans,
);

router.post(
  '/platform/plans',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ body: dto.createPlanDto }),
  controller.createPlan,
);

router.patch(
  '/platform/plans/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.planIdParamDto, body: dto.updatePlanDto }),
  controller.updatePlan,
);

// ==========================================
// 3. Platform Staff Tenant Subscriptions
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

export default router;
