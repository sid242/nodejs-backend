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

    if (campaign.status !== 'SENDING') {
      await campaignRepo.updateCampaign(tenantId, campaignId, { status: 'SENDING' });
    }

    const template = await templateRepo.findTemplateById(tenantId, campaign.templateId);
    if (!template) {
      await campaignRepo.updateCampaign(tenantId, campaignId, { status: 'FAILED' });
      return;
    }

    logger.info(
      { campaignId, totalRecipients: campaign.totalRecipients },
      'Processing WhatsApp broadcast campaign dispatch with pagination and recipient tracking',
    );

    const BATCH_SIZE = 200;
    while (true) {
      // Re-check campaign status in case cancelled mid-run
      const currentCampaign = await campaignRepo.findCampaignById(tenantId, campaignId);
      if (currentCampaign?.status === 'CANCELLED') {
        logger.info({ campaignId }, 'Campaign was cancelled mid-flight; stopping dispatch');
        return;
      }

      const pendingBatch = await campaignRepo.listPendingCampaignRecipients(
        tenantId,
        campaignId,
        BATCH_SIZE,
      );

      if (pendingBatch.length === 0) {
        break;
      }

      for (const r of pendingBatch) {
        const contact = await contactRepo.findContactById(tenantId, r.contactId);
        if (!contact) {
          await campaignRepo.updateCampaignRecipient(tenantId, r.id, {
            status: 'FAILED',
            errorCode: 'CONTACT_NOT_FOUND',
          });
          continue;
        }

        try {
          const sentMessage = await sendTemplateMessage(tenantId, campaign.createdBy || 'system', {
            phoneNumberId: campaign.phoneNumberId,
            to: contact.phoneNumber,
            template: {
              name: template.name,
              language: template.language,
            },
            idempotencyKey: `campaign:${campaign.id}:recipient:${r.id}`,
          });

          await campaignRepo.updateCampaignRecipient(tenantId, r.id, {
            status: 'SENT',
            messageId: sentMessage?.id,
          });
        } catch (err) {
          const errorCode =
            err && typeof err === 'object' && 'code' in err
              ? String(err.code)
              : 'WHATSAPP_SEND_FAILED';

          await campaignRepo.updateCampaignRecipient(tenantId, r.id, {
            status: 'FAILED',
            errorCode,
          });

          logger.warn(
            { err, contactId: r.contactId, campaignId },
            'Failed to dispatch campaign message to recipient',
          );
        }
      }
    }

    // Reconcile final status and counts directly from recipient records
    const summary = await campaignRepo.getCampaignRecipientSummary(tenantId, campaignId);
    const finalStatus =
      summary.sent === 0 && summary.failed > 0 && summary.pending === 0 ? 'FAILED' : 'COMPLETED';

    await campaignRepo.updateCampaign(tenantId, campaignId, {
      status: finalStatus,
      acceptedCount: summary.sent,
      failedCount: summary.failed,
    });

    logger.info(
      { campaignId, finalStatus, summary },
      'WhatsApp broadcast campaign dispatch completed with recipient-level reconciliation',
    );
  });
}
