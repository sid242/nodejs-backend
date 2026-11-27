import type { WhatsAppConsentPurpose, WhatsAppContactConsentRecord } from '@/db/schema';
import { currentTenantCtx, runWithTenantDb, tenantDb } from '@/db/tenancy/context';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import { whatsAppSendQueue } from '@/queues/index';

import * as accountRepo from '../repositories/whatsapp-account.repository';
import * as campaignRepo from '../repositories/whatsapp-campaign.repository';
import * as contactRepo from '../repositories/whatsapp-contact.repository';
import * as templateRepo from '../repositories/whatsapp-template.repository';
import { normalizePhoneNumber } from '../utils/phone-number.util';

export interface CreateCampaignDto {
  name: string;
  templateId: string;
  phoneNumberId?: string;
  recipients: Array<{
    phoneNumber: string;
    displayName?: string;
    parameters?: Record<string, string>;
  }>;
}

export function isRecipientConsentSuppressed(
  category: string,
  consent?: WhatsAppContactConsentRecord,
): boolean {
  if (category === 'MARKETING') {
    return consent?.status !== 'OPTED_IN';
  }
  return consent?.status === 'OPTED_OUT';
}

export async function createCampaign(tenantId: string, userId: string, dto: CreateCampaignDto) {
  const recipients = new Map<string, CreateCampaignDto['recipients'][number]>();
  for (const recipient of dto.recipients) {
    const phoneNumber = normalizePhoneNumber(recipient.phoneNumber);
    if (!recipients.has(phoneNumber)) recipients.set(phoneNumber, recipient);
  }

  // 1. Verify Template
  const template = await templateRepo.findTemplateById(tenantId, dto.templateId);
  if (!template || template.status !== 'APPROVED') {
    throw AppError.badRequest('Template must be approved before launching a campaign', {
      code: 'WHATSAPP_TEMPLATE_NOT_APPROVED',
    });
  }

  // 2. Resolve Sending Phone Number
  const phone = dto.phoneNumberId
    ? await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId)
    : await findDefaultSendingNumber(tenantId, template.businessAccountId);
  if (!phone || !phone.isEnabled || phone.businessAccountId !== template.businessAccountId) {
    if (dto.phoneNumberId) {
      throw new AppError(
        400,
        'The selected WhatsApp sending number is unavailable',
        'WHATSAPP_CAMPAIGN_SENDER_UNAVAILABLE',
      );
    }
    throw new AppError(
      400,
      'Active WhatsApp sending number is required',
      'WHATSAPP_CAMPAIGN_SENDER_REQUIRED',
    );
  }

  const db = tenantDb();
  const campaign = await db.transaction((tx) =>
    runWithTenantDb({ ...currentTenantCtx(), tenantId, db, tx }, async () => {
      // 3. Create Campaign record
      const campaign = await campaignRepo.createCampaign({
        tenantId,
        name: dto.name,
        templateId: template.id,
        phoneNumberId: phone.phoneNumberId,
        status: 'DRAFT',
        totalRecipients: recipients.size,
        createdBy: userId,
      });

      // 4. Ingest and validate recipients & consent
      const campaignRecipients = [];
      for (const [normalized, recipient] of recipients) {
        let contact = await contactRepo.findContactByPhoneNumber(tenantId, normalized);
        if (!contact) {
          contact = await contactRepo.createContact({
            tenantId,
            phoneNumber: normalized,
            displayName: recipient.displayName || normalized,
          });
        }

        const consent = await contactRepo.findConsent(
          tenantId,
          contact.id,
          (template.category === 'MARKETING'
            ? 'MARKETING'
            : template.category === 'AUTHENTICATION'
              ? 'AUTHENTICATION'
              : 'TRANSACTIONAL') as WhatsAppConsentPurpose,
        );
        // W6: For MARKETING campaigns, require explicit OPTED_IN.
        // Recipients without opt-in are marked SUPPRESSED.
        const isSuppressed = isRecipientConsentSuppressed(template.category, consent);

        campaignRecipients.push({
          tenantId,
          campaignId: campaign.id,
          contactId: contact.id,
          status: isSuppressed ? ('SUPPRESSED' as const) : ('PENDING' as const),
        });
      }

      await campaignRepo.addCampaignRecipients(campaignRecipients);
      return campaign;
    }),
  );

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:campaign:created',
    entityType: 'whatsapp_campaign',
    entityId: campaign.id,
    metadata: {
      name: dto.name,
      recipientsCount: recipients.size,
      templateName: template.name,
    },
  });

  return campaign;
}

async function findDefaultSendingNumber(tenantId: string, businessAccountId: string) {
  const enabled = (await accountRepo.listPhoneNumbers(tenantId, businessAccountId)).filter(
    (phone) => phone.isEnabled,
  );
  return enabled.find((phone) => phone.isDefault) ?? enabled[0];
}

export async function scheduleCampaign(
  tenantId: string,
  userId: string,
  campaignId: string,
  scheduledAt?: string,
) {
  const campaign = await campaignRepo.findCampaignById(tenantId, campaignId);
  if (!campaign) {
    throw AppError.notFound('Campaign not found');
  }

  if (campaign.status !== 'DRAFT') {
    throw AppError.badRequest(`Cannot schedule campaign in '${campaign.status}' state`);
  }

  const now = Date.now();
  const scheduleDate = scheduledAt ? new Date(scheduledAt) : new Date(now);
  const delayMs = scheduleDate.getTime() - now;
  if (scheduledAt && (!Number.isFinite(delayMs) || delayMs <= 0)) {
    throw new AppError(
      400,
      'Choose a future time to schedule the campaign',
      'WHATSAPP_CAMPAIGN_SCHEDULE_PAST',
    );
  }

  const updated = await campaignRepo.updateCampaign(tenantId, campaignId, {
    status: delayMs > 0 ? 'SCHEDULED' : 'SENDING',
    scheduledAt: scheduleDate,
  });

  // Enqueue BullMQ dispatch job
  await whatsAppSendQueue.add(
    'process-campaign',
    {
      tenantId,
      campaignId,
    },
    {
      delay: delayMs,
      jobId: `campaign:${campaignId}`,
      removeOnComplete: true,
    },
  );

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:campaign:scheduled',
    entityType: 'whatsapp_campaign',
    entityId: campaignId,
    metadata: { scheduledAt: scheduleDate.toISOString() },
  });

  return updated;
}

export async function cancelCampaign(tenantId: string, userId: string, campaignId: string) {
  const campaign = await campaignRepo.findCampaignById(tenantId, campaignId);
  if (!campaign) {
    throw AppError.notFound('Campaign not found');
  }

  const updated = await campaignRepo.updateCampaign(tenantId, campaignId, {
    status: 'CANCELLED',
  });

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:campaign:cancelled',
    entityType: 'whatsapp_campaign',
    entityId: campaignId,
  });

  return updated;
}

export async function listCampaigns(tenantId: string) {
  return campaignRepo.listCampaigns(tenantId);
}

export async function getCampaign(tenantId: string, id: string) {
  const campaign = await campaignRepo.findCampaignById(tenantId, id);
  if (!campaign) throw AppError.notFound('Campaign not found');
  const recipients = await campaignRepo.listCampaignRecipients(tenantId, id);
  return { ...campaign, recipients };
}
