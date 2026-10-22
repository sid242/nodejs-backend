import { Router } from 'express';

import { requireAuth } from '@/middleware/auth.js';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform.js';
import { requirePermission } from '@/middleware/rbac.js';
import { requireTenant } from '@/middleware/tenant.js';
import { validate } from '@/middleware/validate.js';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions.js';

import * as controller from './plans.controller.js';
import * as dto from './plans.dto.js';

const router: Router = Router();

// ==========================================
// 1. Public Pricing & Catalog Routes
// ==========================================
router.get('/', controller.listPublicPlans);

// ==========================================
// 2. Customer Tenant Subscription Routes
// ==========================================
router.get(
  '/subscription',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  controller.getTenantSubscription,
);

router.post(
  '/subscription/change',
  requireAuth,
  requireTenant,
  requirePermission('tenants:write'),
  validate({ body: dto.changeSubscriptionDto }),
  controller.changeTenantSubscription,
);

// ==========================================
// 3. Platform Internal Administration Routes
// ==========================================
router.get(
  '/platform',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_READ),
  validate({ query: dto.listPlansQueryDto }),
  controller.listPlatformPlans,
);

router.post(
  '/platform',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ body: dto.createPlanDto }),
  controller.createPlan,
);

router.patch(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.BILLING_MANAGE),
  validate({ params: dto.planIdParamDto, body: dto.updatePlanDto }),
  controller.updatePlan,
);

// Specific plan detail (public)
router.get('/:id', validate({ params: dto.planIdParamDto }), controller.getPlanById);

export default router;
