import type { Job } from 'bullmq';

import { logger } from '@/config/logger';
import { cache } from '@/lib/cache';
import { sendEmail } from '@/lib/mailer';
import * as tenantBrandingRepo from '@/modules/tenants/tenant-branding.repository';
import {
  renderMagicLinkEmail,
  renderPasswordResetEmail,
  renderStaffCredentialsEmail,
  renderTenantInviteEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
  type EmailBranding,
} from '@/templates/emails/index';

async function resolveJobBranding(
  tenantId?: string,
  overrideBranding?: Partial<EmailBranding>,
): Promise<EmailBranding | undefined> {
  if (!tenantId) return overrideBranding as EmailBranding | undefined;
  try {
    const branding = await cache.wrap(`tenant-branding-email:${tenantId}`, 300, async () =>
      tenantBrandingRepo.findBrandingByTenantId(tenantId),
    );
    if (!branding) return overrideBranding as EmailBranding | undefined;
    return {
      companyName: branding.companyName || undefined,
      logoUrl: branding.logoUrl || null,
      primaryColor: branding.primaryColor || undefined,
      secondaryColor: branding.secondaryColor || undefined,
      accentColor: branding.accentColor || undefined,
      supportEmail: branding.supportEmail || undefined,
      ...overrideBranding,
    };
  } catch (err) {
    logger.warn({ err, tenantId }, 'Failed to resolve tenant branding for email job');
    return overrideBranding as EmailBranding | undefined;
  }
}

// Throwing => BullMQ retries with the backoff defined on the queue.
export async function processEmail(job: Job): Promise<void> {
  const branding = await resolveJobBranding(job?.data?.tenantId, job?.data?.branding);
  const data = { ...job?.data, branding };

  switch (job?.name) {
    case 'welcome': {
      const { subject, html } = renderWelcomeEmail(data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
        fromName: branding?.companyName,
        replyTo: branding?.supportEmail || undefined,
      });
    }
    case 'password-reset': {
      const { subject, html } = renderPasswordResetEmail(data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
        fromName: branding?.companyName,
        replyTo: branding?.supportEmail || undefined,
      });
    }
    case 'verify-email': {
      const { subject, html } = renderVerifyEmail(data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
        fromName: branding?.companyName,
        replyTo: branding?.supportEmail || undefined,
      });
    }
    case 'magic-link': {
      const { subject, html } = renderMagicLinkEmail(data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
        fromName: branding?.companyName,
        replyTo: branding?.supportEmail || undefined,
      });
    }
    case 'tenant-invite': {
      const { subject, html } = renderTenantInviteEmail(data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        tenantId: job?.data?.tenantId,
        fromName: branding?.companyName,
        replyTo: branding?.supportEmail || undefined,
      });
    }
    case 'staff-credentials': {
      const { subject, html } = renderStaffCredentialsEmail(data);
      return sendEmail({
        to: job?.data?.to,
        subject,
        html,
        fromName: branding?.companyName,
        replyTo: branding?.supportEmail || undefined,
      });
    }
    default:
      throw new Error(`Unknown email job: ${job?.name}`);
  }
}
