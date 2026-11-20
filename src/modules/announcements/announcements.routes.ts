import { Router } from 'express';

import { optionalAuth, requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './announcements.controller';
import * as dto from './announcements.dto';

const router: Router = Router({ mergeParams: true });

// ─── Public / Tenant Endpoints ───────────────────────────────────────────────

router.get('/active', optionalAuth, controller.getActiveAnnouncements);
router.post('/:id/dismiss', requireAuth, controller.dismissAnnouncement);
router.get('/changelog', controller.listChangelog);

// ─── Platform Control Plane Endpoints ────────────────────────────────────────

router.get(
  '/platform',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_READ),
  controller.listAllAnnouncements,
);

router.post(
  '/platform',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE),
  validate({ body: dto.createAnnouncementDto }),
  controller.createAnnouncement,
);

router.get(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_READ),
  controller.getAnnouncement,
);

router.patch(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE),
  validate({ body: dto.updateAnnouncementDto }),
  controller.updateAnnouncement,
);

router.delete(
  '/platform/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE),
  controller.deleteAnnouncement,
);

router.post(
  '/platform/changelog',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE),
  validate({ body: dto.createChangelogDto }),
  controller.createChangelog,
);

router.patch(
  '/platform/changelog/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE),
  validate({ body: dto.updateChangelogDto }),
  controller.updateChangelog,
);

router.delete(
  '/platform/changelog/:id',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.ANNOUNCEMENTS_MANAGE),
  controller.deleteChangelog,
);

export default router;
