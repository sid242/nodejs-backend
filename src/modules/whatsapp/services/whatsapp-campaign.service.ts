import type { WhatsAppConsentPurpose } from '@/db/schema/enums';
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

export async function createCampaign(tenantId: string, userId: string, dto: CreateCampaignDto) {
  // 1. Verify Template
  const template = await templateRepo.findTemplateById(tenantId, dto.templateId);
  if (!template || template.status !== 'APPROVED') {
    throw AppError.badRequest('Template must be approved before launching a campaign', {
      code: 'WHATSAPP_TEMPLATE_NOT_APPROVED',
    });
  }

  // 2. Resolve Sending Phone Number
  let phone = dto.phoneNumberId
    ? await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId)
    : undefined;
  if (!phone) {
    const numbers = await accountRepo.listPhoneNumbers(tenantId);
    phone = numbers.find((n) => n.isDefault) || numbers[0];
  }
  if (!phone || !phone.isEnabled) {
    throw AppError.badRequest('Active WhatsApp sending number is required');
  }

  // 3. Create Campaign record
  const campaign = await campaignRepo.createCampaign({
    tenantId,
    name: dto.name,
    templateId: template.id,
    phoneNumberId: phone.phoneNumberId,
    status: 'DRAFT',
    totalRecipients: dto.recipients.length,
    createdBy: userId,
  });

  // 4. Ingest and validate recipients & consent
  const campaignRecipients = [];
  for (const r of dto.recipients) {
    const normalized = normalizePhoneNumber(r.phoneNumber);
    let contact = await contactRepo.findContactByPhoneNumber(tenantId, normalized);
    if (!contact) {
      contact = await contactRepo.createContact({
        tenantId,
        phoneNumber: normalized,
        displayName: r.displayName || normalized,
      });
    }

    const consent = await contactRepo.findConsent(
      tenantId,
      contact.id,
      template.category as WhatsAppConsentPurpose,
    );
    const isOptedOut = consent?.status === 'OPTED_OUT';

    campaignRecipients.push({
      tenantId,
      campaignId: campaign.id,
      contactId: contact.id,
      status: isOptedOut ? ('SUPPRESSED' as const) : ('PENDING' as const),
    });
  }

  await campaignRepo.addCampaignRecipients(campaignRecipients);

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:campaign:created',
    entityType: 'whatsapp_campaign',
    entityId: campaign.id,
    metadata: {
      name: dto.name,
      recipientsCount: dto.recipients.length,
      templateName: template.name,
    },
  });

  return campaign;
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

  const scheduleDate = scheduledAt ? new Date(scheduledAt) : new Date();
  const delayMs = Math.max(0, scheduleDate.getTime() - Date.now());

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
