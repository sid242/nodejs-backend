import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import { subscriptions, tenantMembers, users } from '@/db/schema/index';
import { AppError } from '@/lib/errors';
import { notificationQueue } from '@/queues/index';
import { emitToUser, emitToWorkspaceUser } from '@/sockets/emitter';

import { getCatalogEntry, getDefaultPreferencesForCategory } from './notifications.catalog';
import type {
  BroadcastNotificationDto,
  ListNotificationsQueryDto,
  NotificationCategory,
  NotificationPreferenceItemDto,
  NotificationSeverity,
  PushSubscribeDto,
} from './notifications.dto';
import * as repo from './notifications.repository';

export interface NotifyRecipient {
  userId: string;
  memberId?: string | null;
  email?: string | null;
}

export interface NotifyParams {
  recipients: (NotifyRecipient | string)[];
  type: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  link?: string | null;
  data?: Record<string, unknown>;
  tenantId?: string | null;
  actorUserId?: string | null;
  dedupeKey?: string | null;
  expiresAt?: Date | null;
}

export function isWithinQuietHours(
  start?: string | null,
  end?: string | null,
  timezone = 'UTC',
): boolean {
  if (!start || !end) return false;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const min = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const current = `${hour}:${min}`;

    if (start <= end) {
      return current >= start && current <= end;
    } else {
      // Overnight (e.g. 22:00 to 08:00)
      return current >= start || current <= end;
    }
  } catch {
    return false;
  }
}

export async function notify(params: NotifyParams): Promise<void> {
  const catalogEntry = getCatalogEntry(params.type);
  const category = params.category ?? catalogEntry?.category ?? 'SYSTEM';
  const severity = params.severity ?? catalogEntry?.severity ?? 'INFO';
  const isCritical = Boolean(catalogEntry?.isCritical || severity === 'CRITICAL');

  const normalizedRecipients: NotifyRecipient[] = params.recipients.map((r) =>
    typeof r === 'string' ? { userId: r } : r,
  );

  for (const recipient of normalizedRecipients) {
    try {
      // 1. In-app persistence
      const created = await repo.createNotification({
        recipientUserId: recipient.userId,
        recipientMemberId: recipient.memberId ?? null,
        tenantId: params.tenantId ?? null,
        type: params.type,
        category,
        severity,
        title: params.title,
        body: params.body,
        link: params.link ?? null,
        data: params.data ?? {},
        actorUserId: params.actorUserId ?? null,
        dedupeKey: params.dedupeKey ?? null,
        expiresAt: params.expiresAt ?? null,
      });

      if (!created) {
        // Deduplicated: identical notification already exists for recipient
        continue;
      }

      // 2. Real-time WebSocket emission
      const realtimePayload = {
        id: created.id,
        type: created.type,
        category: created.category,
        severity: created.severity,
        title: created.title,
        body: created.body,
        link: created.link,
        createdAt: created.createdAt,
      };
      if (params.tenantId) {
        emitToWorkspaceUser(params.tenantId, recipient.userId, 'notification:new', realtimePayload);
      } else {
        emitToUser(recipient.userId, 'notification:new', realtimePayload);
      }

      // 3. User channel preferences & quiet hours
      const prefs = await repo.getPreferences(recipient.userId, params.tenantId);
      const prefForCategory = prefs.find((p) => p.category === category);

      const channelEmail = isCritical
        ? true
        : (prefForCategory?.channelEmail ?? catalogEntry?.defaultEmail ?? true);

      const channelPush = prefForCategory?.channelPush ?? catalogEntry?.defaultPush ?? false;

      const inQuietHours = isWithinQuietHours(
        prefForCategory?.quietHoursStart,
        prefForCategory?.quietHoursEnd,
        prefForCategory?.timezone ?? 'UTC',
      );

      // Email dispatch
      if (channelEmail && (!inQuietHours || isCritical)) {
        await notificationQueue.add(
          'send-email',
          {
            notificationId: created.id,
            userId: recipient.userId,
            email: recipient.email,
            title: created.title,
            body: created.body,
            link: created.link,
            tenantId: params.tenantId,
            type: params.type,
          },
          {
            jobId: `notif-email-${created.id}`,
            removeOnComplete: true,
          },
        );
      }

      // Web Push dispatch
      if (channelPush && !inQuietHours) {
        await notificationQueue.add(
          'send-push',
          {
            notificationId: created.id,
            userId: recipient.userId,
            title: created.title,
            body: created.body,
            link: created.link,
          },
          {
            jobId: `notif-push-${created.id}`,
            removeOnComplete: true,
          },
        );
      }
    } catch (err) {
      logger.error(
        { err, recipient, type: params.type },
        'Failed to deliver notification to recipient',
      );
    }
  }
}

export async function listNotifications(
  userId: string,
  query: ListNotificationsQueryDto,
  tenantId?: string | null,
) {
  return repo.findMany(userId, query, tenantId);
}

export async function getUnreadCount(userId: string, tenantId?: string | null) {
  const unreadCount = await repo.countUnread(userId, tenantId);
  return { unreadCount };
}

export async function markAsRead(id: string, userId: string) {
  const updated = await repo.markAsRead(id, userId);
  if (!updated) {
    throw AppError.notFound('Notification not found or already read');
  }
  return updated;
}

export async function markAllAsRead(
  userId: string,
  options?: { category?: NotificationCategory; tenantId?: string },
) {
  const updatedCount = await repo.markAllAsRead(userId, options);
  return { updatedCount };
}

export async function archiveNotification(id: string, userId: string) {
  const updated = await repo.archive(id, userId);
  if (!updated) {
    throw AppError.notFound('Notification not found');
  }
  return updated;
}

export async function deleteNotification(id: string, userId: string) {
  const deleted = await repo.deleteNotification(id, userId);
  if (!deleted) {
    throw AppError.notFound('Notification not found');
  }
  return { deleted: true };
}

export async function getUserPreferences(userId: string, tenantId?: string | null) {
  const rawPrefs = await repo.getPreferences(userId, tenantId);
  const categories: NotificationCategory[] = [
    'SECURITY',
    'ACCOUNT',
    'BILLING',
    'TEAM',
    'FILES',
    'SYSTEM',
    'PRODUCT',
  ];

  const result = categories.map((cat) => {
    const existing = rawPrefs.find((p) => p.category === cat);
    if (existing) {
      return {
        category: existing.category,
        channelInApp: existing.channelInApp,
        channelEmail: existing.channelEmail,
        channelPush: existing.channelPush,
        digest: existing.digest,
        quietHoursStart: existing.quietHoursStart,
        quietHoursEnd: existing.quietHoursEnd,
        timezone: existing.timezone ?? 'UTC',
      };
    }
    return getDefaultPreferencesForCategory(cat);
  });

  return { preferences: result };
}

export async function updateUserPreferences(
  userId: string,
  items: NotificationPreferenceItemDto[],
  tenantId?: string | null,
) {
  // Validate invariant: SECURITY category cannot disable email or in-app
  for (const item of items) {
    if (item.category === 'SECURITY' && item.channelEmail === false) {
      throw AppError.badRequest('Security alerts cannot have email channel disabled.');
    }
  }

  const upserted = await repo.upsertPreferences(userId, items, tenantId);
  return { preferences: upserted };
}

export async function subscribePush(userId: string, dto: PushSubscribeDto) {
  const sub = await repo.upsertPushSubscription(
    userId,
    dto.endpoint,
    dto.keys.p256dh,
    dto.keys.auth,
    dto.userAgent,
  );
  return { subscribed: true, id: sub.id };
}

export async function unsubscribePush(userId: string, endpoint: string) {
  const deleted = await repo.deletePushSubscription(userId, endpoint);
  return { unsubscribed: deleted };
}

export async function broadcast(
  input: BroadcastNotificationDto,
  staffId: string,
): Promise<{ sentCount: number }> {
  let userIds: string[] = [];

  switch (input.target.type) {
    case 'ALL': {
      const allUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.status, 'ACTIVE'));
      userIds = allUsers.map((u) => u.id);
      break;
    }
    case 'TENANT': {
      if (!input.target.tenantId) {
        throw AppError.badRequest('tenantId is required for TENANT target');
      }
      const members = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, input.target.tenantId),
            eq(tenantMembers.status, 'ACTIVE'),
          ),
        );
      userIds = members.map((m) => m.userId);
      break;
    }
    case 'PLAN': {
      if (!input.target.planId) {
        throw AppError.badRequest('planId is required for PLAN target');
      }
      const subTenants = await db
        .select({ tenantId: subscriptions.tenantId })
        .from(subscriptions)
        .where(
          and(eq(subscriptions.planId, input.target.planId), eq(subscriptions.status, 'ACTIVE')),
        );
      const tenantIds = subTenants.map((s) => s.tenantId);
      if (tenantIds.length > 0) {
        const members = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(inArray(tenantMembers.tenantId, tenantIds), eq(tenantMembers.status, 'ACTIVE')),
          );
        userIds = Array.from(new Set(members.map((m) => m.userId)));
      }
      break;
    }
    case 'USERS': {
      userIds = input.target.userIds ?? [];
      break;
    }
  }

  if (userIds.length === 0) {
    return { sentCount: 0 };
  }

  await notify({
    recipients: userIds,
    type: 'system.announcement',
    category: input.category,
    severity: input.severity,
    title: input.title,
    body: input.body,
    link: input.link,
    actorUserId: staffId,
  });

  return { sentCount: userIds.length };
}
