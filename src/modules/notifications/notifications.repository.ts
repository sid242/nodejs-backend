import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  notificationPreferences,
  notifications,
  pushSubscriptions,
  type NewNotificationPreferenceRecord,
  type NewNotificationRecord,
  type NotificationPreferenceRecord,
  type NotificationRecord,
  type PushSubscriptionRecord,
} from '@/db/schema/index';

import type {
  ListNotificationsQueryDto,
  NotificationCategory,
  NotificationPreferenceItemDto,
} from './notifications.dto';
import type { PushActor, PushDevice } from './push/push.types';

export interface PaginatedNotificationsResult {
  items: NotificationRecord[];
  nextCursor?: string;
  totalUnread: number;
}

export async function findMany(
  userId: string,
  query: ListNotificationsQueryDto,
  tenantId?: string | null,
): Promise<PaginatedNotificationsResult> {
  const conditions = [eq(notifications.recipientUserId, userId)];

  if (tenantId) {
    conditions.push(or(eq(notifications.tenantId, tenantId), isNull(notifications.tenantId))!);
  }

  if (query.unread) {
    conditions.push(isNull(notifications.readAt));
  }

  if (query.category) {
    conditions.push(eq(notifications.category, query.category));
  }

  if (!query.includeArchived) {
    conditions.push(isNull(notifications.archivedAt));
  }

  // Parse cursor if present: format "ISO_DATE|UUID"
  if (query.cursor) {
    try {
      const decoded = Buffer.from(query.cursor, 'base64').toString('utf-8');
      const [cursorDateIso, cursorId] = decoded.split('|');
      if (cursorDateIso && cursorId) {
        const cursorDate = new Date(cursorDateIso);
        conditions.push(
          or(
            lt(notifications.createdAt, cursorDate),
            and(eq(notifications.createdAt, cursorDate), lt(notifications.id, cursorId)),
          )!,
        );
      }
    } catch {
      /* ignore invalid cursor */
    }
  }

  const limit = query.limit ?? 20;

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | undefined;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    if (lastItem) {
      const rawCursor = `${lastItem.createdAt.toISOString()}|${lastItem.id}`;
      nextCursor = Buffer.from(rawCursor).toString('base64');
    }
  }

  const totalUnread = await countUnread(userId, tenantId);

  return { items, nextCursor, totalUnread };
}

export async function countUnread(userId: string, tenantId?: string | null): Promise<number> {
  const conditions = [
    eq(notifications.recipientUserId, userId),
    isNull(notifications.readAt),
    isNull(notifications.archivedAt),
  ];

  if (tenantId) {
    conditions.push(or(eq(notifications.tenantId, tenantId), isNull(notifications.tenantId))!);
  }

  const [res] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(...conditions));

  return res?.count ?? 0;
}

export async function findById(
  id: string,
  userId: string,
): Promise<NotificationRecord | undefined> {
  const [record] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, userId)));
  return record;
}

export async function markAsRead(
  id: string,
  userId: string,
): Promise<NotificationRecord | undefined> {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientUserId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning();

  if (!updated) {
    return findById(id, userId);
  }
  return updated;
}

export async function markAllAsRead(
  userId: string,
  options?: { category?: NotificationCategory; tenantId?: string },
): Promise<number> {
  const conditions = [eq(notifications.recipientUserId, userId), isNull(notifications.readAt)];

  if (options?.category) {
    conditions.push(eq(notifications.category, options.category));
  }

  if (options?.tenantId) {
    conditions.push(
      or(eq(notifications.tenantId, options.tenantId), isNull(notifications.tenantId))!,
    );
  }

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: notifications.id });

  return updated.length;
}

export async function archive(id: string, userId: string): Promise<NotificationRecord | undefined> {
  const [updated] = await db
    .update(notifications)
    .set({ archivedAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, userId)))
    .returning();
  return updated;
}

export async function deleteNotification(id: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, userId)))
    .returning({ id: notifications.id });
  return deleted.length > 0;
}

export async function createNotification(
  data: NewNotificationRecord,
): Promise<NotificationRecord | undefined> {
  if (data.dedupeKey) {
    const [inserted] = await db
      .insert(notifications)
      .values(data)
      .onConflictDoNothing({
        target: [notifications.recipientUserId, notifications.dedupeKey],
      })
      .returning();
    return inserted;
  }

  const [inserted] = await db.insert(notifications).values(data).returning();
  return inserted;
}

export async function createManyNotifications(
  records: NewNotificationRecord[],
): Promise<NotificationRecord[]> {
  if (records.length === 0) return [];
  return db.insert(notifications).values(records).returning();
}

// Notification Preferences
export async function getPreferences(
  userId: string,
  tenantId?: string | null,
): Promise<NotificationPreferenceRecord[]> {
  const conditions = [eq(notificationPreferences.userId, userId)];
  if (tenantId) {
    conditions.push(eq(notificationPreferences.tenantId, tenantId));
  } else {
    conditions.push(isNull(notificationPreferences.tenantId));
  }

  return db
    .select()
    .from(notificationPreferences)
    .where(and(...conditions));
}

export async function upsertPreferences(
  userId: string,
  items: NotificationPreferenceItemDto[],
  tenantId?: string | null,
): Promise<NotificationPreferenceRecord[]> {
  const results: NotificationPreferenceRecord[] = [];

  for (const item of items) {
    const payload: NewNotificationPreferenceRecord = {
      userId,
      tenantId: tenantId ?? null,
      category: item.category,
      channelInApp: item.channelInApp ?? true,
      channelEmail: item.channelEmail ?? true,
      channelPush: item.channelPush ?? false,
      digest: item.digest ?? 'NONE',
      quietHoursStart: item.quietHoursStart ?? null,
      quietHoursEnd: item.quietHoursEnd ?? null,
      timezone: item.timezone ?? 'UTC',
      updatedAt: new Date(),
    };

    const [upserted] = await db
      .insert(notificationPreferences)
      .values(payload)
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.tenantId,
          notificationPreferences.category,
        ],
        set: {
          channelInApp: payload.channelInApp,
          channelEmail: payload.channelEmail,
          channelPush: payload.channelPush,
          digest: payload.digest,
          quietHoursStart: payload.quietHoursStart,
          quietHoursEnd: payload.quietHoursEnd,
          timezone: payload.timezone,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (upserted) {
      results.push(upserted);
    }
  }

  return results;
}

// Push Subscriptions & Multi-Channel Devices
const MAX_DEVICES_PER_ACTOR = 10;

function actorWhere(actor: PushActor) {
  return actor.actorType === 'STAFF'
    ? eq(pushSubscriptions.staffId, actor.actorId)
    : eq(pushSubscriptions.userId, actor.actorId);
}

function toPushDevice(row: PushSubscriptionRecord): PushDevice {
  return {
    id: row.id,
    actorType: row.staffId ? 'STAFF' : 'USER',
    actorId: (row.staffId ?? row.userId)!,
    channel: row.channel,
    platform: row.platform,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    token: row.token,
    failureCount: row.failureCount,
  };
}

export async function upsertPushSubscription(
  actor: PushActor,
  input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
    platform?: string;
    appVersion?: string;
  },
): Promise<PushSubscriptionRecord> {
  const now = new Date();
  const ownerValues =
    actor.actorType === 'STAFF'
      ? { userId: null, staffId: actor.actorId }
      : { userId: actor.actorId, staffId: null };

  return db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(pushSubscriptions)
      .values({
        ...ownerValues,
        channel: 'webpush',
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        platform: input.platform ?? 'web',
        appVersion: input.appVersion ?? null,
        userAgent: input.userAgent ?? null,
        failureCount: 0,
        disabledAt: null,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.endpoint],
        targetWhere: sql`"endpoint" IS NOT NULL`,
        set: {
          ...ownerValues,
          channel: 'webpush',
          p256dh: input.p256dh,
          auth: input.auth,
          platform: input.platform ?? 'web',
          appVersion: input.appVersion ?? null,
          userAgent: input.userAgent ?? null,
          failureCount: 0,
          disabledAt: null,
          lastUsedAt: now,
        },
      })
      .returning();

    if (!sub) {
      throw new Error('Failed to upsert push subscription');
    }

    // Enforce bounded device list per actor (drop oldest beyond MAX_DEVICES_PER_ACTOR)
    const ownedRows = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(actorWhere(actor))
      .orderBy(desc(pushSubscriptions.lastUsedAt), desc(pushSubscriptions.createdAt));

    if (ownedRows.length > MAX_DEVICES_PER_ACTOR) {
      const idsToDrop = ownedRows.slice(MAX_DEVICES_PER_ACTOR).map((r) => r.id);
      await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, idsToDrop));
    }

    return sub;
  });
}

export async function deletePushSubscription(actor: PushActor, endpoint: string): Promise<boolean> {
  const res = await db
    .delete(pushSubscriptions)
    .where(and(actorWhere(actor), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return res.length > 0;
}

export async function deletePushSubscriptionById(actor: PushActor, id: string): Promise<boolean> {
  const res = await db
    .delete(pushSubscriptions)
    .where(and(actorWhere(actor), eq(pushSubscriptions.id, id)))
    .returning({ id: pushSubscriptions.id });
  return res.length > 0;
}

export async function deletePushDeviceRowById(id: string): Promise<boolean> {
  const res = await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.id, id))
    .returning({ id: pushSubscriptions.id });
  return res.length > 0;
}

export async function listPushDevicesForActor(actor: PushActor): Promise<PushSubscriptionRecord[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(actorWhere(actor))
    .orderBy(desc(pushSubscriptions.lastUsedAt), desc(pushSubscriptions.createdAt));
}

export async function getEnabledPushDevicesForActor(actor: PushActor): Promise<PushDevice[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(and(actorWhere(actor), isNull(pushSubscriptions.disabledAt)));
  return rows.map(toPushDevice);
}

export async function getPushSubscriptionsForUser(
  userId: string,
): Promise<PushSubscriptionRecord[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)));
}

export async function markPushDeviceSent(id: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({
      failureCount: 0,
      disabledAt: null,
      lastUsedAt: new Date(),
    })
    .where(eq(pushSubscriptions.id, id));
}

export async function markPushDeviceFailed(id: string, disableThreshold = 5): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({
      failureCount: sql`${pushSubscriptions.failureCount} + 1`,
      disabledAt: sql`CASE WHEN ${pushSubscriptions.failureCount} + 1 >= ${disableThreshold} THEN NOW() ELSE ${pushSubscriptions.disabledAt} END`,
    })
    .where(eq(pushSubscriptions.id, id));
}

// Housekeeping
export async function cleanupOldNotifications(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const now = new Date();

  const deleted = await db
    .delete(notifications)
    .where(
      or(
        and(lt(notifications.readAt, cutoff), isNull(notifications.archivedAt)),
        lt(notifications.expiresAt, now),
      )!,
    )
    .returning({ id: notifications.id });

  return deleted.length;
}
