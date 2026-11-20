import { Router } from 'express';

import { optionalAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './feature-flags.controller';
import * as dto from './feature-flags.dto';

const router: Router = Router({ mergeParams: true });

// ─── Public / Client Evaluation Routes ───────────────────────────────────────

router.get('/resolve', optionalAuth, controller.evaluateAllFlags);
router.get('/evaluate/:key', optionalAuth, controller.evaluateFlag);

// ─── Platform Control Plane Routes ───────────────────────────────────────────

router.get(
  '/platform',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_READ),
  controller.listFlags,
);

router.post(
  '/platform',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE),
  validate({ body: dto.createFeatureFlagDto }),
  controller.createFlag,
);

router.get(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_READ),
  controller.getFlag,
);

router.patch(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE),
  validate({ body: dto.updateFeatureFlagDto }),
  controller.updateFlag,
);

router.delete(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE),
  controller.deleteFlag,
);

router.post(
  '/platform/:id/rules',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE),
  validate({ body: dto.createFeatureFlagRuleDto }),
  controller.createRule,
);

router.patch(
  '/platform/:id/rules/:ruleId',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE),
  validate({ body: dto.updateFeatureFlagRuleDto }),
  controller.updateRule,
);

router.delete(
  '/platform/:id/rules/:ruleId',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE),
  controller.deleteRule,
);

export default router;
