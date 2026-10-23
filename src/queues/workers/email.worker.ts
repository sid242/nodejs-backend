import type { Job } from 'bullmq';

import { sendEmail } from '@/lib/mailer.js';
import {
  renderMagicLinkEmail,
  renderPasswordResetEmail,
  renderStaffCredentialsEmail,
  renderTenantInviteEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
} from '@/templates/emails/index.js';

// Throwing => BullMQ retries with the backoff defined on the queue.
export async function processEmail(job: Job): Promise<void> {
  switch (job?.name) {
    case 'welcome': {
      const { subject, html } = renderWelcomeEmail(job.data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
      });
    }
    case 'password-reset': {
      const { subject, html } = renderPasswordResetEmail(job.data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
      });
    }
    case 'verify-email': {
      const { subject, html } = renderVerifyEmail(job.data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
      });
    }
    case 'magic-link': {
      const { subject, html } = renderMagicLinkEmail(job.data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
      });
    }
    case 'tenant-invite': {
      const { subject, html } = renderTenantInviteEmail(job.data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
      });
    }
    case 'staff-credentials': {
      const { subject, html } = renderStaffCredentialsEmail(job.data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
      });
    }
    default:
      throw new Error(`Unknown email job: ${job?.name}`);
  }
}
