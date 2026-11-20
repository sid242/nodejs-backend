import { Router } from 'express';

import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './maintenance.controller';

const router: Router = Router();

router.use(requirePlatformAuth);

router.get(
  '/global',
  requirePlatformPermission(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE),
  controller.getGlobalMaintenance,
);

router.post(
  '/global',
  requirePlatformPermission(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE),
  controller.setGlobalMaintenance,
);

router.get(
  '/tenants/:tenantId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE),
  controller.getTenantMaintenance,
);

router.post(
  '/tenants/:tenantId',
  requirePlatformPermission(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE),
  controller.setTenantMaintenance,
);

export default router;
