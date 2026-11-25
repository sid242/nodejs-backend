import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { env } from '@/config/env';
import { closeRedisClients } from '@/config/redis';
import { platformRoles, platformStaff, pushSubscriptions, users } from '@/db/schema/index';
import {
  NOTIFICATION_CATALOG,
  resolveSafePushContent,
} from '@/modules/notifications/notifications.catalog';
import { pushSubscribeDto } from '@/modules/notifications/notifications.dto';
import * as repo from '@/modules/notifications/notifications.repository';
import * as notificationsService from '@/modules/notifications/notifications.service';
import { isAllowedPushEndpoint } from '@/modules/notifications/push/push.security';
import type { PushDevice, PushMessage } from '@/modules/notifications/push/push.types';
import {
  createWebPushProvider,
  serializePushPayload,
  type WebPushClient,
} from '@/modules/notifications/push/webpush.provider';
import { handleSendPushJob } from '@/queues/workers/notification.worker';

describe('Push Notification Module', () => {
  const createdUserIds: string[] = [];
  const createdStaffIds: string[] = [];
  const createdRoleIds: string[] = [];

  after(async () => {
    try {
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
      if (createdStaffIds.length > 0) {
        await db.delete(platformStaff).where(inArray(platformStaff.id, createdStaffIds));
      }
      if (createdRoleIds.length > 0) {
        await db.delete(platformRoles).where(inArray(platformRoles.id, createdRoleIds));
      }
    } finally {
      await Promise.allSettled([closeRedisClients(), closeDb()]);
    }
  });

  it('validates SSRF allowlist strictly (accepts trusted HTTPS push hosts, rejects unsafe URLs)', () => {
    const valid = [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://updates.push.services.mozilla.com/wpush/v2/token',
      'https://web.push.apple.com/Q123456',
      'https://wns2-bl2p.notify.windows.com/?token=xyz',
    ];
    for (const url of valid) {
      assert.equal(isAllowedPushEndpoint(url), true, `Expected allowlisted URL: ${url}`);
      assert.equal(
        pushSubscribeDto.safeParse({ endpoint: url, keys: { p256dh: 'k1', auth: 'k2' } }).success,
        true,
      );
    }

    const rejected = [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost:3009/ssrf',
      'https://evil.example.com/push',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pass@fcm.googleapis.com/fcm/send/abc',
      'https://push.apple.com/no-subdomain',
    ];
    for (const url of rejected) {
      assert.equal(isAllowedPushEndpoint(url), false, `Expected rejected URL: ${url}`);
      assert.equal(
        pushSubscribeDto.safeParse({ endpoint: url, keys: { p256dh: 'k1', auth: 'k2' } }).success,
        false,
      );
    }
  });

  it('strips potentially sensitive or PHI text via catalog resolveSafePushContent', () => {
    const chatMention = resolveSafePushContent(
      'chat.mention',
      'Alice mentioned you',
      'Patient John Doe has lab result 42',
    );
    assert.equal(chatMention.body.includes('Patient John Doe'), false);
    assert.equal(chatMention.title, 'New chat mention');

    const unknownType = resolveSafePushContent(
      'clinical.patient_note',
      'Patient Jane',
      'Confidential note body',
    );
    assert.equal(unknownType.title.includes('Jane'), false);
    assert.equal(unknownType.body.includes('Confidential'), false);

    // Explicitly pushSafe catalog items preserve announcement text
    assert.equal(NOTIFICATION_CATALOG['system.announcement']?.pushSafe, true);
    const announcement = resolveSafePushContent(
      'system.announcement',
      'Maintenance Notice',
      'Scheduled window tonight at 02:00 UTC',
    );
    assert.equal(announcement.title, 'Maintenance Notice');
  });

  it('truncates oversized push payloads safely below 4KB limit', () => {
    const hugeBody = 'A'.repeat(6000);
    const serialized = serializePushPayload({
      notificationId: '11111111-1111-4111-8111-111111111111',
      title: 'Update',
      body: hugeBody,
      link: '/settings/notifications',
    });
    assert.ok(Buffer.byteLength(serialized, 'utf8') < 4096);
  });

  it('webpush provider maps 201, 404/410, 429, 500, and 400 responses accurately', async () => {
    const prevPub = env.VAPID_PUBLIC_KEY;
    const prevPriv = env.VAPID_PRIVATE_KEY;
    env.VAPID_PUBLIC_KEY = 'BTestPublicKeyValueForUnitTestOnly1234567890';
    env.VAPID_PRIVATE_KEY = 'TestPrivateKeyValueForUnitTest1234567890';

    try {
      const device: PushDevice = {
        id: 'dev-1',
        actorType: 'USER',
        actorId: 'usr-1',
        channel: 'webpush',
        platform: 'web',
        endpoint: 'https://fcm.googleapis.com/fcm/send/unit-test',
        p256dh: 'p256dh-val',
        auth: 'auth-val',
        token: null,
        failureCount: 0,
      };
      const message: PushMessage = {
        notificationId: 'notif-1',
        title: 'Hello',
        body: 'World',
      };

      const makeProvider = (impl: WebPushClient['sendNotification']) =>
        createWebPushProvider({
          setVapidDetails: () => {},
          sendNotification: impl,
        });

      const sentRes = await makeProvider(async () => ({ statusCode: 201 })).send(device, message);
      assert.equal(sentRes.status, 'sent');

      const goneRes = await makeProvider(async () => {
        throw { statusCode: 410, message: 'Gone' };
      }).send(device, message);
      assert.equal(goneRes.status, 'gone');

      const retryRes = await makeProvider(async () => {
        throw { statusCode: 429, headers: { 'retry-after': '12' }, message: 'Rate limited' };
      }).send(device, message);
      assert.equal(retryRes.status, 'retry');
      assert.equal(retryRes.retryAfterMs, 12_000);

      const err500 = await makeProvider(async () => {
        throw { statusCode: 503, message: 'Unavailable' };
      }).send(device, message);
      assert.equal(err500.status, 'retry');

      const err400 = await makeProvider(async () => {
        throw { statusCode: 400, message: 'Bad subscription' };
      }).send(device, message);
      assert.equal(err400.status, 'failed');
    } finally {
      env.VAPID_PUBLIC_KEY = prevPub;
      env.VAPID_PRIVATE_KEY = prevPriv;
    }
  });

  it('worker skips cleanly when VAPID keys missing and applies sent/gone/failed/retry results', async () => {
    const skipped = await handleSendPushJob(
      { notificationId: 'n1', userId: 'u1', title: 'Hi', body: 'There' },
      {
        isConfigured: () => false,
        getDevices: async () => {
          throw new Error('Should not query devices when unconfigured');
        },
        getProvider: () => undefined,
        deleteDevice: async () => true,
        markSent: async () => {},
        markFailed: async () => {},
      },
    );
    assert.deepEqual(skipped, { sent: 0, gone: 0, failed: 0, retry: 0 });

    const calls: string[] = [];
    const devices: PushDevice[] = [
      {
        id: 'd-sent',
        actorType: 'USER',
        actorId: 'u1',
        channel: 'webpush',
        platform: 'web',
        endpoint: 'https://fcm.googleapis.com/fcm/send/1',
        p256dh: 'a',
        auth: 'b',
        token: null,
        failureCount: 0,
      },
      {
        id: 'd-gone',
        actorType: 'USER',
        actorId: 'u1',
        channel: 'webpush',
        platform: 'web',
        endpoint: 'https://fcm.googleapis.com/fcm/send/2',
        p256dh: 'a',
        auth: 'b',
        token: null,
        failureCount: 0,
      },
      {
        id: 'd-fail',
        actorType: 'USER',
        actorId: 'u1',
        channel: 'webpush',
        platform: 'web',
        endpoint: 'https://fcm.googleapis.com/fcm/send/3',
        p256dh: 'a',
        auth: 'b',
        token: null,
        failureCount: 0,
      },
    ];

    const summary = await handleSendPushJob(
      { notificationId: 'n2', userId: 'u1', title: 'Hi', body: 'There' },
      {
        isConfigured: () => true,
        getDevices: async () => devices,
        getProvider: () => ({
          channel: 'webpush',
          isConfigured: () => true,
          send: async (d) => {
            if (d.id === 'd-sent') return { status: 'sent' };
            if (d.id === 'd-gone') return { status: 'gone', statusCode: 410 };
            return { status: 'failed', statusCode: 400, reason: 'bad' };
          },
        }),
        deleteDevice: async (id) => {
          calls.push(`delete:${id}`);
          return true;
        },
        markSent: async (id) => {
          calls.push(`sent:${id}`);
        },
        markFailed: async (id) => {
          calls.push(`fail:${id}`);
        },
      },
    );
    assert.deepEqual(summary, { sent: 1, gone: 1, failed: 1, retry: 0 });
    assert.deepEqual(calls, ['sent:d-sent', 'delete:d-gone', 'fail:d-fail']);

    // Transient retry should throw to trigger BullMQ backoff
    await assert.rejects(
      () =>
        handleSendPushJob(
          { notificationId: 'n3', userId: 'u1', title: 'Hi', body: 'There' },
          {
            isConfigured: () => true,
            getDevices: async () => [devices[0]!],
            getProvider: () => ({
              channel: 'webpush',
              isConfigured: () => true,
              send: async () => ({ status: 'retry', statusCode: 503, reason: 'Down' }),
            }),
            deleteDevice: async () => true,
            markSent: async () => {},
            markFailed: async () => {},
          },
        ),
      /transient failure/i,
    );
  });

  it('reassigns shared-workstation endpoint between users/staff, disables after 5 failures, and caps devices at 10', async () => {
    const pwHash = await bcrypt.hash('Password@123456', 4);
    const suffix = randomUUID().slice(0, 8);
    const [u1] = await db
      .insert(users)
      .values({
        email: `push-u1-${suffix}@example.test`,
        firstName: 'Push',
        lastName: 'User1',
        passwordHash: pwHash,
        status: 'ACTIVE',
      })
      .returning();
    const [u2] = await db
      .insert(users)
      .values({
        email: `push-u2-${suffix}@example.test`,
        firstName: 'Push',
        lastName: 'User2',
        passwordHash: pwHash,
        status: 'ACTIVE',
      })
      .returning();
    const [role] = await db
      .insert(platformRoles)
      .values({
        key: `PUSH_ROLE_${suffix}`,
        name: `Push Role ${suffix}`,
      })
      .returning();
    const [staff] = await db
      .insert(platformStaff)
      .values({
        email: `push-staff-${suffix}@example.test`,
        displayName: 'Push Staff',
        passwordHash: pwHash,
        roleId: role!.id,
        status: 'ACTIVE',
      })
      .returning();

    createdUserIds.push(u1!.id, u2!.id);
    createdRoleIds.push(role!.id);
    createdStaffIds.push(staff!.id);

    const sharedEndpoint = `https://fcm.googleapis.com/fcm/send/shared-${suffix}`;
    await notificationsService.subscribePush(u1!.id, {
      endpoint: sharedEndpoint,
      keys: { p256dh: 'p1', auth: 'a1' },
      userAgent: 'Chrome/1',
    });
    assert.equal(
      (await repo.getEnabledPushDevicesForActor({ actorType: 'USER', actorId: u1!.id })).length,
      1,
    );

    // User 2 signs in on same browser and subscribes -> endpoint transfers to User 2
    await notificationsService.subscribePush(u2!.id, {
      endpoint: sharedEndpoint,
      keys: { p256dh: 'p2', auth: 'a2' },
      userAgent: 'Chrome/2',
    });
    assert.equal(
      (await repo.getEnabledPushDevicesForActor({ actorType: 'USER', actorId: u1!.id })).length,
      0,
    );
    assert.equal(
      (await repo.getEnabledPushDevicesForActor({ actorType: 'USER', actorId: u2!.id })).length,
      1,
    );

    // Platform staff can also subscribe on the same browser endpoint -> transfers cleanly
    const staffSub = await notificationsService.subscribePush(
      { actorType: 'STAFF', actorId: staff!.id },
      { endpoint: sharedEndpoint, keys: { p256dh: 'p3', auth: 'a3' } },
    );
    assert.equal(
      (await repo.getEnabledPushDevicesForActor({ actorType: 'USER', actorId: u2!.id })).length,
      0,
    );
    assert.equal(
      (await repo.getEnabledPushDevicesForActor({ actorType: 'STAFF', actorId: staff!.id })).length,
      1,
    );

    // Auto-disable device at 5 consecutive failures
    for (let i = 0; i < 5; i++) {
      await repo.markPushDeviceFailed(staffSub.id, 5);
    }
    const [afterFailRow] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, staffSub.id));
    assert.equal(afterFailRow?.failureCount, 5);
    assert.ok(afterFailRow?.disabledAt);
    assert.equal(
      (await repo.getEnabledPushDevicesForActor({ actorType: 'STAFF', actorId: staff!.id })).length,
      0,
    );

    // Device cap at 10 per user
    for (let i = 0; i < 12; i++) {
      await notificationsService.subscribePush(u1!.id, {
        endpoint: `https://fcm.googleapis.com/fcm/send/cap-${suffix}-${i}`,
        keys: { p256dh: `pk-${i}`, auth: `ak-${i}` },
      });
    }
    const u1Devices = await repo.listPushDevicesForActor({ actorType: 'USER', actorId: u1!.id });
    assert.equal(u1Devices.length, 10);
  });
});
