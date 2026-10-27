import { Router } from 'express';

import { requireAuth } from '@/middleware/auth.js';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform.js';
import { requirePermission } from '@/middleware/rbac.js';
import { requireTenant } from '@/middleware/tenant.js';
import { validate } from '@/middleware/validate.js';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions.js';

import * as controller from './billing.controller.js';
import * as dto from './billing.dto.js';

const router: Router = Router();

// ==========================================
// 1. Tenant-Scoped Invoices & Billing Routes
// ==========================================
router.get(
  '/invoices',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  validate({ query: dto.listInvoicesQueryDto }),
  controller.getTenantInvoices,
);

router.get(
  '/invoices/:id',
  requireAuth,
  requireTenant,
  requirePermission('tenants:read'),
  validate({ params: dto.invoiceIdParamDto }),
  controller.getTenantInvoiceById,
);

// ==========================================
// 2. Platform Staff Billing Administration
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
