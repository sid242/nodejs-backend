import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import type {
  BroadcastNotificationDto,
  ListNotificationsQueryDto,
  NotificationIdParamDto,
  PushDeviceIdParamDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
  ReadAllNotificationsDto,
  UpdatePreferencesDto,
} from './notifications.dto';
import * as service from './notifications.service';
import type { PushActor } from './push/push.types';

function resolvePushActor(req: Request): PushActor {
  if (req.staff?.id) {
    return { actorType: 'STAFF', actorId: req.staff.id };
  }
  return { actorType: 'USER', actorId: req.user!.id };
}

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListNotificationsQueryDto;
  const result = await service.listNotifications(req.user!.id, query, req.tenant?.id);
  res.json(AppResponse.ok(result, 'Notifications fetched successfully'));
});

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getUnreadCount(req.user!.id, req.tenant?.id);
  res.json(AppResponse.ok(result));
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as NotificationIdParamDto;
  const result = await service.markAsRead(id, req.user!.id);
  res.json(AppResponse.ok(result, 'Notification marked as read'));
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ReadAllNotificationsDto;
  const result = await service.markAllAsRead(req.user!.id, {
    category: body?.category,
    tenantId: body?.tenantId ?? req.tenant?.id,
  });
  res.json(AppResponse.ok(result, 'Notifications marked as read'));
});

export const archiveNotification = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as NotificationIdParamDto;
  const result = await service.archiveNotification(id, req.user!.id);
  res.json(AppResponse.ok(result, 'Notification archived'));
});

export const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as NotificationIdParamDto;
  const result = await service.deleteNotification(id, req.user!.id);
  res.json(AppResponse.ok(result, 'Notification deleted'));
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getUserPreferences(req.user!.id, req.tenant?.id);
  res.json(AppResponse.ok(result));
});

export const updatePreferences = asyncHandler(async (req: Request, res: Response) => {
  const { preferences } = req.body as UpdatePreferencesDto;
  const result = await service.updateUserPreferences(req.user!.id, preferences, req.tenant?.id);
  res.json(AppResponse.ok(result, 'Notification preferences updated successfully'));
});

export const getPushPublicKey = asyncHandler(async (_req: Request, res: Response) => {
  const result = service.getPushPublicKeyConfig();
  res.json(AppResponse.ok(result));
});

export const listPushDevices = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listPushDevices(resolvePushActor(req));
  res.json(AppResponse.ok(result));
});

export const subscribePush = asyncHandler(async (req: Request, res: Response) => {
  const dto = req.body as PushSubscribeDto;
  const result = await service.subscribePush(resolvePushActor(req), dto);
  res.status(201).json(AppResponse.created(result, 'Web push subscribed'));
});

export const unsubscribePush = asyncHandler(async (req: Request, res: Response) => {
  const { endpoint } = req.body as PushUnsubscribeDto;
  const result = await service.unsubscribePush(resolvePushActor(req), endpoint);
  res.json(AppResponse.ok(result, 'Web push unsubscribed'));
});

export const removePushDevice = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as PushDeviceIdParamDto;
  const result = await service.removePushDevice(resolvePushActor(req), id);
  res.json(AppResponse.ok(result, 'Push device removed'));
});

export const sendTestPush = asyncHandler(async (req: Request, res: Response) => {
  const actor = resolvePushActor(req);
  const link =
    actor.actorType === 'STAFF'
      ? '/platform/settings/notifications'
      : req.tenant?.slug
        ? `/w/${req.tenant.slug}/settings/notifications`
        : '/settings/notifications';
  const result = await service.sendTestPush(actor, {
    tenantId: req.tenant?.id ?? null,
    link,
  });
  res.json(AppResponse.ok(result, 'Test push notification queued'));
});

export const broadcast = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as BroadcastNotificationDto;
  const staffId = req.staff?.id ?? req.user!.id;
  const result = await service.broadcast(body, staffId);
  res.json(
    AppResponse.ok(result, `Broadcast successfully dispatched to ${result.sentCount} recipients`),
  );
});
