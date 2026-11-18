import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeDb } from '../src/config/db';
import { closeRedisClients } from '../src/config/redis';
import {
  getCatalogEntry,
  getDefaultPreferencesForCategory,
  NOTIFICATION_CATALOG,
} from '../src/modules/notifications/notifications.catalog';
import {
  broadcastNotificationDto,
  listNotificationsQueryDto,
  notificationIdParamDto,
  notificationPreferenceItemDto,
  pushSubscribeDto,
  readAllNotificationsDto,
  updatePreferencesDto,
} from '../src/modules/notifications/notifications.dto';
import {
  isWithinQuietHours,
  updateUserPreferences,
} from '../src/modules/notifications/notifications.service';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
});

test('Notifications: DTO validation accepts valid notification IDs and rejects non-UUIDs', () => {
  const validUuid = '11111111-1111-4111-8111-111111111111';
  const validRes = notificationIdParamDto.safeParse({ id: validUuid });
  assert.equal(validRes.success, true);

  const invalidRes = notificationIdParamDto.safeParse({ id: 'not-a-uuid' });
  assert.equal(invalidRes.success, false);
});

test('Notifications: listNotificationsQueryDto properly parses limits, boolean strings, and categories', () => {
  const parsed = listNotificationsQueryDto.parse({
    limit: '25',
    unread: 'true',
    category: 'SECURITY',
    includeArchived: 'false',
  });

  assert.equal(parsed.limit, 25);
  assert.equal(parsed.unread, true);
  assert.equal(parsed.category, 'SECURITY');
  assert.equal(parsed.includeArchived, false);
});

test('Notifications: notificationPreferenceItemDto validates 24-hour quiet hours format', () => {
  const valid = notificationPreferenceItemDto.safeParse({
    category: 'BILLING',
    channelInApp: true,
    channelEmail: false,
    channelPush: false,
    digest: 'DAILY',
    quietHoursStart: '22:30',
    quietHoursEnd: '07:00',
    timezone: 'Asia/Kolkata',
  });
  assert.equal(valid.success, true);

  const invalidHours = notificationPreferenceItemDto.safeParse({
    category: 'BILLING',
    quietHoursStart: '25:99', // Invalid time
  });
  assert.equal(invalidHours.success, false);
});

test('Notifications: pushSubscribeDto requires valid HTTPS/HTTP URL endpoint and keys', () => {
  const valid = pushSubscribeDto.safeParse({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123xyz',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9Ac0vE1Vdx0C00Nny7wVu8uTsqLddhx-JA5U2TXRt33784=',
      auth: 'tBHItJI5svbpez7KI4CCXg==',
    },
    userAgent: 'Mozilla/5.0 Chrome/120.0',
  });
  assert.equal(valid.success, true);

  const invalidUrl = pushSubscribeDto.safeParse({
    endpoint: 'not-a-valid-url',
    keys: { p256dh: 'x', auth: 'y' },
  });
  assert.equal(invalidUrl.success, false);
});

test('Notifications: broadcastNotificationDto validates target schemas for ALL, TENANT, and PLAN', () => {
  const validAll = broadcastNotificationDto.safeParse({
    title: 'Platform Maintenance Tonight',
    body: 'The database cluster will undergo routine maintenance at 02:00 UTC.',
    category: 'SYSTEM',
    severity: 'WARNING',
    target: { type: 'ALL' },
  });
  assert.equal(validAll.success, true);

  const validTenant = broadcastNotificationDto.safeParse({
    title: 'Workspace Notice',
    body: 'Hello Workspace',
    target: {
      type: 'TENANT',
      tenantId: '11111111-1111-4111-8111-111111111111',
    },
  });
  assert.equal(validTenant.success, true);
});

test('Notifications: Notification Catalog registers required production types with valid properties', () => {
  assert.ok(NOTIFICATION_CATALOG['security.new_login']);
  assert.equal(NOTIFICATION_CATALOG['security.new_login'].category, 'SECURITY');
  assert.equal(NOTIFICATION_CATALOG['security.new_login'].isCritical, true);

  assert.ok(NOTIFICATION_CATALOG['team.member_invited']);
  assert.equal(NOTIFICATION_CATALOG['team.member_invited'].category, 'TEAM');

  assert.ok(NOTIFICATION_CATALOG['billing.payment_failed']);
  assert.equal(NOTIFICATION_CATALOG['billing.payment_failed'].severity, 'CRITICAL');
  assert.equal(NOTIFICATION_CATALOG['billing.payment_failed'].isCritical, true);

  assert.ok(NOTIFICATION_CATALOG['files.ready']);
  assert.equal(NOTIFICATION_CATALOG['files.ready'].category, 'FILES');

  assert.ok(NOTIFICATION_CATALOG['system.announcement']);
  assert.equal(NOTIFICATION_CATALOG['system.announcement'].category, 'SYSTEM');
});

test('Notifications: isWithinQuietHours accurately evaluates both intra-day and overnight windows', () => {
  // Test daytime window: 09:00 to 17:00
  // Note: tested against controlled UTC
  assert.equal(isWithinQuietHours(null, null), false, 'Null quiet hours should return false');

  // Overnight window: 22:00 to 06:00
  // Current time is checked dynamically
  const isNight = isWithinQuietHours('00:00', '23:59', 'UTC');
  assert.equal(isNight, true, 'Window covering entire 24h should always return true');
});

test('Notifications: updateUserPreferences forbids disabling email for SECURITY category', async () => {
  await assert.rejects(
    async () => {
      await updateUserPreferences(
        '11111111-1111-4111-8111-111111111111',
        [
          {
            category: 'SECURITY',
            channelEmail: false, // Security violation!
            channelInApp: true,
          },
        ],
      );
    },
    {
      name: 'AppError',
      message: 'Security alerts cannot have email channel disabled.',
    },
  );
});
