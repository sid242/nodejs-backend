import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { notificationLimiter } from '@/middleware/rate-limit';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './notifications.controller';
import {
  broadcastNotificationDto,
  listNotificationsQueryDto,
  notificationIdParamDto,
  pushDeviceIdParamDto,
  pushSubscribeDto,
  pushUnsubscribeDto,
  readAllNotificationsDto,
  updatePreferencesDto,
} from './notifications.dto';

function mountPushSubRoutes(targetRouter: Router, prefix: string): void {
  targetRouter.get(`${prefix}/public-key`, controller.getPushPublicKey);
  targetRouter.get(`${prefix}/subscriptions`, controller.listPushDevices);
  targetRouter.post(
    `${prefix}/subscribe`,
    validate({ body: pushSubscribeDto }),
    controller.subscribePush,
  );
  targetRouter.delete(
    `${prefix}/subscribe`,
    validate({ body: pushUnsubscribeDto }),
    controller.unsubscribePush,
  );
  targetRouter.delete(
    `${prefix}/subscriptions/:id`,
    validate({ params: pushDeviceIdParamDto }),
    controller.removePushDevice,
  );
  targetRouter.post(`${prefix}/test`, controller.sendTestPush);
}

const router = Router();

// Platform broadcast route (requires platform staff auth + broadcast permission)
router.post(
  '/broadcast',
  requirePlatformAuth,
  requirePlatformPermission(PLATFORM_PERMISSIONS.NOTIFICATIONS_BROADCAST),
  validate({ body: broadcastNotificationDto }),
  controller.broadcast,
);

// User-facing notification routes (require authenticated user + resolved tenant context)
router.use(requireAuth);
router.use(resolveTenantContext);
router.use(notificationLimiter);

router.get('/', validate({ query: listNotificationsQueryDto }), controller.listNotifications);
router.get('/unread-count', controller.getUnreadCount);
router.post('/read-all', validate({ body: readAllNotificationsDto }), controller.markAllAsRead);

router.get('/preferences', controller.getPreferences);
router.put('/preferences', validate({ body: updatePreferencesDto }), controller.updatePreferences);

mountPushSubRoutes(router, '/push');

router.post('/:id/read', validate({ params: notificationIdParamDto }), controller.markAsRead);
router.post(
  '/:id/archive',
  validate({ params: notificationIdParamDto }),
  controller.archiveNotification,
);
router.delete('/:id', validate({ params: notificationIdParamDto }), controller.deleteNotification);

export const platformPushRouter: Router = Router();
platformPushRouter.use(requirePlatformAuth);
platformPushRouter.use(notificationLimiter);
mountPushSubRoutes(platformPushRouter, '');

export default router;
