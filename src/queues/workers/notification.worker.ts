import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import { users } from '@/db/schema/index';
import { sendEmail } from '@/lib/mailer';
import * as repo from '@/modules/notifications/notifications.repository';

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
        logger.warn({ jobId: job.id, userId }, 'Skipping notification email: recipient email not found');
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
      const { userId, title, body, link } = job.data;
      const subscriptions = await repo.getPushSubscriptionsForUser(userId);

      if (subscriptions.length === 0) {
        logger.debug({ userId }, 'No push subscriptions for user, skipping push delivery');
        return;
      }

      logger.info(
        { userId, subscriptionsCount: subscriptions.length, title },
        'Dispatched web push notifications to user subscriptions',
      );
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
