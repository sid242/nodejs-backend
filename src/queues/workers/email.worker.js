import { sendEmail } from '../../lib/mailer.js';
import {
  renderWelcomeEmail,
  renderPasswordResetEmail,
  renderVerifyEmail,
} from '../../templates/emails/index.js';

// Throwing => BullMQ retries with the backoff defined on the queue.
export async function processEmail(job) {
  switch (job.name) {
    case 'welcome': {
      const { subject, html } = renderWelcomeEmail(job.data);
      return sendEmail({ to: job.data.to, subject, html });
    }
    case 'password-reset': {
      const { subject, html } = renderPasswordResetEmail(job.data);
      return sendEmail({ to: job.data.to, subject, html });
    }
    case 'verify-email': {
      const { subject, html } = renderVerifyEmail(job.data);
      return sendEmail({ to: job.data.to, subject, html });
    }
    default:
      throw new Error(`Unknown email job: ${job.name}`);
  }
}
