import type { Job } from 'bullmq';

import { logger } from '@/config/logger';
import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/db/tenancy/tenant-db';

import * as campaignRepo from '../repositories/whatsapp-campaign.repository';
import * as contactRepo from '../repositories/whatsapp-contact.repository';
import * as templateRepo from '../repositories/whatsapp-template.repository';
import { sendTemplateMessage } from '../services/whatsapp-message.service';

export interface CampaignJobData {
  tenantId: string;
  campaignId: string;
}

export async function processWhatsAppCampaignJob(job: Job<CampaignJobData>): Promise<void> {
  const { tenantId, campaignId } = job.data;
  const db = await getTenantDb(tenantId);

  await runWithTenantDb({ tenantId, db }, async () => {
    const campaign = await campaignRepo.findCampaignById(tenantId, campaignId);
    if (!campaign || campaign.status === 'CANCELLED') {
      return;
    }

    const template = await templateRepo.findTemplateById(tenantId, campaign.templateId);
    if (!template) {
      await campaignRepo.updateCampaign(tenantId, campaignId, { status: 'FAILED' });
      return;
    }

    const recipients = await campaignRepo.listCampaignRecipients(tenantId, campaignId, 1000);
    const pending = recipients.filter((r) => r.status === 'PENDING');

    logger.info(
      { campaignId, total: recipients.length, pending: pending.length },
      'Processing WhatsApp broadcast campaign dispatch',
    );

    let sent = 0;
    let failed = 0;

    for (const r of pending) {
      const contact = await contactRepo.findContactById(tenantId, r.contactId);
      if (!contact) continue;

      try {
        await sendTemplateMessage(tenantId, campaign.createdBy || 'system', {
          phoneNumberId: campaign.phoneNumberId,
          to: contact.phoneNumber,
          template: {
            name: template.name,
            language: template.language,
          },
          idempotencyKey: `campaign:${campaign.id}:recipient:${r.id}`,
        });
        sent++;
        await campaignRepo.incrementCampaignCounters(tenantId, campaignId, 'accepted');
      } catch (err) {
        failed++;
        await campaignRepo.incrementCampaignCounters(tenantId, campaignId, 'failed');
        logger.warn(
          { err, contactId: r.contactId, campaignId },
          'Failed to dispatch campaign message to recipient',
        );
      }
    }

    await campaignRepo.updateCampaign(tenantId, campaignId, {
      status: 'COMPLETED',
    });

    logger.info({ campaignId, sent, failed }, 'WhatsApp broadcast campaign dispatch completed');
  });
}
