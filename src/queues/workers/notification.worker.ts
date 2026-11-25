import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import { users } from '@/db/schema/index';
import { sendEmail } from '@/lib/mailer';
import * as repo from '@/modules/notifications/notifications.repository';
import { getPushProvider } from '@/modules/notifications/push/push.registry';
import type {
  PushActor,
  PushDevice,
  PushMessage,
  PushProvider,
} from '@/modules/notifications/push/push.types';
import {
  isWebPushConfigured,
  warnIfWebPushUnconfigured,
} from '@/modules/notifications/push/webpush.provider';

export interface SendPushJobData {
  notificationId: string;
  actorType?: 'USER' | 'STAFF';
  actorId?: string;
  userId?: string;
  title: string;
  body: string;
  link?: string | null;
  tenantId?: string | null;
  category?: string;
  tag?: string;
}

export interface SendPushDeps {
  isConfigured: () => boolean;
  getDevices: (actor: PushActor) => Promise<PushDevice[]>;
  getProvider: (channel: PushDevice['channel']) => PushProvider | undefined;
  deleteDevice: (id: string) => Promise<boolean>;
  markSent: (id: string) => Promise<void>;
  markFailed: (id: string) => Promise<void>;
}

const defaultSendPushDeps: SendPushDeps = {
  isConfigured: isWebPushConfigured,
  getDevices: repo.getEnabledPushDevicesForActor,
  getProvider: getPushProvider,
  deleteDevice: repo.deletePushDeviceRowById,
  markSent: repo.markPushDeviceSent,
  markFailed: (id) => repo.markPushDeviceFailed(id, 5),
};

export async function handleSendPushJob(
  data: SendPushJobData,
  deps: SendPushDeps = defaultSendPushDeps,
): Promise<{ sent: number; gone: number; failed: number; retry: number }> {
  const actorId = data.actorId ?? data.userId;
  const actorType = data.actorType ?? 'USER';
  if (!actorId) {
    return { sent: 0, gone: 0, failed: 0, retry: 0 };
  }

  if (!deps.isConfigured()) {
    warnIfWebPushUnconfigured();
    return { sent: 0, gone: 0, failed: 0, retry: 0 };
  }

  const devices = await deps.getDevices({ actorType, actorId });
  if (devices.length === 0) {
    logger.debug(
      { actorType, actorId },
      'No enabled push devices for actor, skipping push delivery',
    );
    return { sent: 0, gone: 0, failed: 0, retry: 0 };
  }

  const msg: PushMessage = {
    notificationId: data.notificationId,
    title: data.title,
    body: data.body,
    link: data.link ?? null,
    tenantId: data.tenantId ?? null,
    category: data.category,
    tag: data.tag ?? data.notificationId,
  };

  let sent = 0;
  let gone = 0;
  let failed = 0;
  let retry = 0;
  let retryReason = 'Temporary push provider error';

  for (const device of devices) {
    const provider = deps.getProvider(device.channel);
    if (!provider || !provider.isConfigured()) continue;

    const result = await provider.send(device, msg);
    switch (result.status) {
      case 'sent': {
        sent++;
        await deps.markSent(device.id);
        break;
      }
      case 'gone': {
        gone++;
        await deps.deleteDevice(device.id);
        logger.info(
          { actorType, actorId, deviceId: device.id, statusCode: result.statusCode },
          'Removed expired/gone push subscription',
        );
        break;
      }
      case 'failed': {
        failed++;
        await deps.markFailed(device.id);
        logger.warn(
          { actorType, actorId, deviceId: device.id, reason: result.reason },
          'Permanent push delivery failure recorded for device',
        );
        break;
      }
      case 'retry': {
        retry++;
        if (result.reason) retryReason = result.reason;
        logger.warn(
          {
            actorType,
            actorId,
            deviceId: device.id,
            statusCode: result.statusCode,
            retryAfterMs: result.retryAfterMs,
          },
          'Transient push delivery error; scheduling retry',
        );
        break;
      }
    }
  }

  if (retry > 0) {
    throw new Error(`Push delivery transient failure (${retry} device(s)): ${retryReason}`);
  }

  return { sent, gone, failed, retry };
}

export async function processNotification(job: Job): Promise<void> {
  switch (job.name) {
    case 'send-email': {
      const { userId, email: providedEmail, title, body, link, tenantId } = job.data;
      let targetEmail = providedEmail;

      if (!targetEmail && userId) {
        const [user] = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId));
        targetEmail = user?.email;
      }

      if (!targetEmail) {
        logger.warn(
          { jobId: job.id, userId },
          'Skipping notification email: recipient email not found',
        );
        return;
      }

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a1a;">${title}</h2>
          <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">${body}</p>
          ${
            link
              ? `<div style="margin-top: 24px;">
                  <a href="${link}" style="background-color: #2563eb; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View in App</a>
                </div>`
              : ''
          }
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
          <p style="color: #888888; font-size: 12px;">This is an automated notification from your account.</p>
        </div>
      `;

      await sendEmail({
        to: targetEmail,
        subject: title,
        html,
        tenantId,
      });

      logger.info({ jobId: job.id, userId, targetEmail }, 'Notification email sent successfully');
      break;
    }

    case 'send-push': {
      await handleSendPushJob(job.data as SendPushJobData);
      break;
    }

    case 'cleanup-notifications': {
      const deletedCount = await repo.cleanupOldNotifications(90);
      logger.info({ deletedCount }, 'Notification retention cleanup completed');
      break;
    }

    default: {
      logger.warn({ jobName: job.name, jobId: job.id }, 'Unknown notification job name');
    }
  }
}
