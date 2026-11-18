import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { bearerAuth, errorResponse, successResponse } from '@/docs/helpers';
import {
  broadcastNotificationDto,
  listNotificationsQueryDto,
  notificationIdParamDto,
  pushSubscribeDto,
  pushUnsubscribeDto,
  readAllNotificationsDto,
  updatePreferencesDto,
} from '@/modules/notifications/notifications.dto';

export function registerNotificationsDocs(registry: OpenAPIRegistry): void {
  const NotificationSchema = registry.register(
    'Notification',
    z.object({
      id: z.string().uuid().openapi({ example: 'd3b07384-d113-40f4-9ed3-2051d95e6cf1' }),
      tenantId: z.string().uuid().nullable().openapi({ example: 'c1b07384-d113-40f4-9ed3-2051d95e6cf2' }),
      recipientUserId: z.string().uuid().openapi({ example: 'a2b07384-d113-40f4-9ed3-2051d95e6cf3' }),
      type: z.string().openapi({ example: 'team.member_invited' }),
      category: z.enum(['SECURITY', 'ACCOUNT', 'BILLING', 'TEAM', 'FILES', 'SYSTEM', 'PRODUCT']).openapi({ example: 'TEAM' }),
      severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']).openapi({ example: 'INFO' }),
      title: z.string().openapi({ example: 'You have been invited to Acme Corp' }),
      body: z.string().openapi({ example: 'John has invited you to join Acme Corp as a member.' }),
      link: z.string().nullable().openapi({ example: '/w/acme-corp/settings/members' }),
      data: z.record(z.unknown()).openapi({ example: {} }),
      readAt: z.string().datetime().nullable().openapi({ example: null }),
      archivedAt: z.string().datetime().nullable().openapi({ example: null }),
      createdAt: z.string().datetime().openapi({ example: '2026-11-18T10:00:00.000Z' }),
    }),
  );

  const PaginatedNotificationsSchema = registry.register(
    'PaginatedNotifications',
    z.object({
      items: z.array(NotificationSchema),
      nextCursor: z.string().optional().openapi({ example: 'MjAyNi0xMS0xOF...==' }),
      totalUnread: z.number().openapi({ example: 3 }),
    }),
  );

  const UnreadCountSchema = registry.register(
    'UnreadCount',
    z.object({
      unreadCount: z.number().openapi({ example: 3 }),
    }),
  );

  const NotificationPreferenceSchema = registry.register(
    'NotificationPreference',
    z.object({
      category: z.string().openapi({ example: 'SECURITY' }),
      channelInApp: z.boolean().openapi({ example: true }),
      channelEmail: z.boolean().openapi({ example: true }),
      channelPush: z.boolean().openapi({ example: false }),
      digest: z.enum(['NONE', 'DAILY', 'WEEKLY']).openapi({ example: 'NONE' }),
      quietHoursStart: z.string().nullable().openapi({ example: '22:00' }),
      quietHoursEnd: z.string().nullable().openapi({ example: '08:00' }),
      timezone: z.string().openapi({ example: 'UTC' }),
    }),
  );

  const NotificationPreferencesListSchema = registry.register(
    'NotificationPreferencesList',
    z.object({
      preferences: z.array(NotificationPreferenceSchema),
    }),
  );

  // --- Routes ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/notifications',
    summary: 'List user notifications',
    description: 'Fetch paginated in-app notifications for the authenticated user, optionally scoped to tenant.',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      query: listNotificationsQueryDto,
    },
    responses: {
      200: successResponse(PaginatedNotificationsSchema, 'Paginated notifications list'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/notifications/unread-count',
    summary: 'Get total unread notifications count',
    description: 'Returns real-time unread notification count for the user and workspace.',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(UnreadCountSchema, 'Unread count'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/notifications/{id}/read',
    summary: 'Mark single notification as read',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: notificationIdParamDto,
    },
    responses: {
      200: successResponse(NotificationSchema, 'Marked notification as read'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Notification not found'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/notifications/read-all',
    summary: 'Mark all notifications as read',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: readAllNotificationsDto } } },
    },
    responses: {
      200: successResponse(z.object({ updatedCount: z.number() }), 'Marked all as read'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/notifications/{id}/archive',
    summary: 'Archive notification',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: notificationIdParamDto,
    },
    responses: {
      200: successResponse(NotificationSchema, 'Notification archived'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Notification not found'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/notifications/{id}',
    summary: 'Delete notification',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: notificationIdParamDto,
    },
    responses: {
      200: successResponse(z.object({ deleted: z.boolean() }), 'Notification deleted'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Notification not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/notifications/preferences',
    summary: 'Get notification channel and quiet hour preferences',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: successResponse(NotificationPreferencesListSchema, 'User notification preferences'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/notifications/preferences',
    summary: 'Update notification preferences',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: updatePreferencesDto } } },
    },
    responses: {
      200: successResponse(NotificationPreferencesListSchema, 'Updated preferences'),
      400: errorResponse('Invalid parameters or security override violated'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/notifications/push/subscribe',
    summary: 'Register Web Push subscription',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: pushSubscribeDto } } },
    },
    responses: {
      201: successResponse(z.object({ subscribed: z.boolean(), id: z.string().uuid() }), 'Web push subscribed'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/notifications/push/subscribe',
    summary: 'Unsubscribe Web Push subscription',
    tags: ['Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: pushUnsubscribeDto } } },
    },
    responses: {
      200: successResponse(z.object({ unsubscribed: z.boolean() }), 'Web push unsubscribed'),
      401: errorResponse('Unauthorized'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/notifications/broadcast',
    summary: 'Platform broadcast notification dispatch',
    description: 'Allows platform operators to dispatch broadcast notifications across workspaces, plans, or users.',
    tags: ['Platform', 'Notifications'],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { 'application/json': { schema: broadcastNotificationDto } } },
    },
    responses: {
      200: successResponse(z.object({ sentCount: z.number() }), 'Broadcast dispatched'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Forbidden: requires notifications:broadcast permission'),
    },
  });
}
