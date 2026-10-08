import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env, isProd } from '@/config/env.js';
import { logger } from '@/config/logger.js';

const ses = new SESv2Client({ region: env.AWS_REGION });

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  if (!isProd || !env.SES_FROM_EMAIL) {
    logger.info({ to, subject }, '[mailer] (not sent: non-prod or SES_FROM_EMAIL unset)');
    return;
  }
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html } } } },
    }),
  );
}
