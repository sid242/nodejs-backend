import type { WhatsAppConsentPurpose, WhatsAppMessageType } from '@/db/schema/enums';
import { AppError } from '@/lib/errors';

import { metaWhatsAppProvider } from '../providers/meta-cloud-api.provider';
import * as accountRepo from '../repositories/whatsapp-account.repository';
import * as contactRepo from '../repositories/whatsapp-contact.repository';
import * as convRepo from '../repositories/whatsapp-conversation.repository';
import * as messageRepo from '../repositories/whatsapp-message.repository';
import * as templateRepo from '../repositories/whatsapp-template.repository';
import * as usageRepo from '../repositories/whatsapp-usage.repository';
import type {
  TemplateComponentDefinition,
  TemplateComponentInput,
} from '../types/whatsapp-provider.types';
import { getCountryFromPhoneNumber, normalizePhoneNumber } from '../utils/phone-number.util';
import { validateTemplateParameters } from '../utils/template-variables.util';
import { getDecryptedAccountToken } from './whatsapp-onboarding.service';

export interface SendTemplateMessageDto {
  phoneNumberId?: string;
  to: string;
  template: {
    name: string;
    language?: string;
    components?: TemplateComponentInput[];
  };
  idempotencyKey?: string;
}

export interface SendTextMessageDto {
  phoneNumberId?: string;
  to: string;
  text: string;
  previewUrl?: boolean;
  idempotencyKey?: string;
}

export interface SendMediaMessageDto {
  phoneNumberId?: string;
  to: string;
  type: 'image' | 'document' | 'video' | 'audio';
  media: {
    id?: string;
    link?: string;
    caption?: string;
    filename?: string;
  };
  idempotencyKey?: string;
}

export async function sendTemplateMessage(
  tenantId: string,
  userId: string,
  dto: SendTemplateMessageDto,
) {
  // 1. Idempotency Check
  if (dto.idempotencyKey) {
    const existing = await messageRepo.findMessageByIdempotencyKey(tenantId, dto.idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  // 2. Normalize and validate recipient phone number
  const recipientPhone = normalizePhoneNumber(dto.to);

  // 3. Resolve sending phone number
  let phone = dto.phoneNumberId
    ? await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId)
    : undefined;

  if (!phone) {
    const numbers = await accountRepo.listPhoneNumbers(tenantId);
    phone = numbers.find((n) => n.isDefault) || numbers[0];
  }

  if (!phone || !phone.isEnabled) {
    throw AppError.badRequest('No active WhatsApp phone number available for sending', {
      code: 'WHATSAPP_PHONE_NUMBER_DISABLED',
    });
  }

  // 4. Resolve Template
  const language = dto.template.language || 'en';
  const template = await templateRepo.findTemplateByName(tenantId, dto.template.name, language);

  if (!template) {
    throw AppError.notFound(`WhatsApp template '${dto.template.name}' not found`, {
      code: 'WHATSAPP_TEMPLATE_NOT_FOUND',
    });
  }

  if (template.status !== 'APPROVED') {
    throw AppError.badRequest(
      `Cannot send message: Template '${template.name}' is in '${template.status}' status (must be APPROVED).`,
      { code: 'WHATSAPP_TEMPLATE_NOT_APPROVED', status: template.status },
    );
  }

  // 5. Contact & Consent Management
  let contact = await contactRepo.findContactByPhoneNumber(tenantId, recipientPhone);
  if (!contact) {
    contact = await contactRepo.createContact({
      tenantId,
      phoneNumber: recipientPhone,
      displayName: recipientPhone,
    });
  }

  const consent = await contactRepo.findConsent(
    tenantId,
    contact.id,
    template.category as WhatsAppConsentPurpose,
  );
  if (consent?.status === 'OPTED_OUT') {
    throw AppError.badRequest(
      `Recipient ${recipientPhone} has opted out of ${template.category} messages`,
      { code: 'WHATSAPP_CONSENT_REQUIRED' },
    );
  }

  // 6. Validate template parameters
  const bodyComponent = (template.components as Array<{ type: string; text?: string }>)?.find(
    (c) => c.type === 'BODY',
  );
  if (bodyComponent?.text) {
    const suppliedParams =
      dto.template.components?.find((c) => c.type === 'body')?.parameters || [];
    validateTemplateParameters(bodyComponent.text, suppliedParams);
  }

  // 7. Resolve or create conversation
  let conversation = await convRepo.findConversationByContactAndPhone(
    tenantId,
    phone.phoneNumberId,
    contact.id,
  );
  if (!conversation) {
    conversation = await convRepo.createConversation({
      tenantId,
      phoneNumberId: phone.phoneNumberId,
      contactId: contact.id,
      status: 'OPEN',
      lastMessageAt: new Date(),
    });
  }

  // 8. Create Outbound Message Record (Outbox Pattern)
  const messageRecord = await messageRepo.createMessage({
    tenantId,
    phoneNumberId: phone.phoneNumberId,
    contactId: contact.id,
    conversationId: conversation.id,
    direction: 'OUTBOUND',
    messageType: 'TEMPLATE',
    templateId: template.id,
    idempotencyKey: dto.idempotencyKey || null,
    body: `[Template: ${template.name}]`,
    payload: dto.template as unknown as Record<string, unknown>,
    internalStatus: 'QUEUED',
  });

  // 9. Dispatch to Meta Cloud API
  const { accessToken } = await getDecryptedAccountToken(tenantId);
  try {
    const sendResult = await metaWhatsAppProvider.sendTemplateMessage({
      phoneNumberId: phone.phoneNumberId,
      accessToken,
      to: recipientPhone,
      template: {
        name: template.name,
        language: { code: language },
        components: dto.template.components,
      },
    });

    // 10. Update message record on success
    const updated = await messageRepo.updateMessageStatus(tenantId, messageRecord.id, {
      providerMessageId: sendResult.providerMessageId,
      providerStatus: 'accepted',
      internalStatus: 'ACCEPTED',
      acceptedAt: new Date(),
    });

    // Update conversation timestamp
    await convRepo.updateConversation(tenantId, conversation.id, {
      lastMessageAt: new Date(),
    });

    // 11. Record billable usage estimate
    const country = getCountryFromPhoneNumber(recipientPhone);
    const estimatedCost = template.category === 'MARKETING' ? '0.80' : '0.40';
    await usageRepo.recordUsage({
      tenantId,
      wabaId: template.businessAccountId,
      phoneNumberId: phone.phoneNumberId,
      recipientCountry: country,
      templateCategory: template.category,
      providerMessageId: sendResult.providerMessageId,
      deliveryStatus: 'ACCEPTED',
      estimatedCost,
      currency: 'INR',
    });

    return updated;
  } catch (err) {
    await messageRepo.updateMessageStatus(tenantId, messageRecord.id, {
      internalStatus: 'FAILED',
      failedAt: new Date(),
      errorCode: (err as { code?: string })?.code || 'WHATSAPP_MESSAGE_FAILED',
      errorMessage: (err as Error)?.message,
    });
    throw err;
  }
}

export async function sendTextMessage(tenantId: string, userId: string, dto: SendTextMessageDto) {
  const recipientPhone = normalizePhoneNumber(dto.to);

  // Resolve Phone
  let phone = dto.phoneNumberId
    ? await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId)
    : undefined;
  if (!phone) {
    const numbers = await accountRepo.listPhoneNumbers(tenantId);
    phone = numbers.find((n) => n.isDefault) || numbers[0];
  }
  if (!phone || !phone.isEnabled) {
    throw AppError.badRequest('No active WhatsApp phone number available', {
      code: 'WHATSAPP_PHONE_NUMBER_DISABLED',
    });
  }

  // Resolve Contact
  let contact = await contactRepo.findContactByPhoneNumber(tenantId, recipientPhone);
  if (!contact) {
    contact = await contactRepo.createContact({
      tenantId,
      phoneNumber: recipientPhone,
      displayName: recipientPhone,
    });
  }

  // Resolve Conversation & Check 24-Hour Customer Service Window
  const conversation = await convRepo.findConversationByContactAndPhone(
    tenantId,
    phone.phoneNumberId,
    contact.id,
  );

  const now = new Date();
  const windowExpiry = conversation?.customerServiceWindowExpiresAt;
  const isWindowActive = windowExpiry ? windowExpiry > now : false;

  if (!isWindowActive) {
    throw AppError.badRequest(
      'Cannot send free-form text message: 24-hour customer service window is closed. Send an approved template message to re-engage the customer.',
      {
        code: 'WHATSAPP_CUSTOMER_SERVICE_WINDOW_EXPIRED',
        customerServiceWindowExpiresAt: windowExpiry,
      },
    );
  }

  const messageRecord = await messageRepo.createMessage({
    tenantId,
    phoneNumberId: phone.phoneNumberId,
    contactId: contact.id,
    conversationId: conversation!.id,
    direction: 'OUTBOUND',
    messageType: 'TEXT',
    body: dto.text,
    internalStatus: 'QUEUED',
  });

  const { accessToken } = await getDecryptedAccountToken(tenantId);
  try {
    const res = await metaWhatsAppProvider.sendTextMessage({
      phoneNumberId: phone.phoneNumberId,
      accessToken,
      to: recipientPhone,
      text: dto.text,
      previewUrl: dto.previewUrl,
    });

    const updated = await messageRepo.updateMessageStatus(tenantId, messageRecord.id, {
      providerMessageId: res.providerMessageId,
      internalStatus: 'ACCEPTED',
      acceptedAt: new Date(),
    });

    await convRepo.updateConversation(tenantId, conversation!.id, {
      lastMessageAt: new Date(),
    });

    return updated;
  } catch (err) {
    await messageRepo.updateMessageStatus(tenantId, messageRecord.id, {
      internalStatus: 'FAILED',
      failedAt: new Date(),
      errorCode: (err as { code?: string })?.code || 'WHATSAPP_MESSAGE_FAILED',
      errorMessage: (err as Error)?.message,
    });
    throw err;
  }
}

export async function sendMediaMessage(tenantId: string, userId: string, dto: SendMediaMessageDto) {
  const recipientPhone = normalizePhoneNumber(dto.to);

  let phone = dto.phoneNumberId
    ? await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId)
    : undefined;
  if (!phone) {
    const numbers = await accountRepo.listPhoneNumbers(tenantId);
    phone = numbers.find((n) => n.isDefault) || numbers[0];
  }
  if (!phone || !phone.isEnabled) {
    throw AppError.badRequest('No active WhatsApp phone number available');
  }

  let contact = await contactRepo.findContactByPhoneNumber(tenantId, recipientPhone);
  if (!contact) {
    contact = await contactRepo.createContact({
      tenantId,
      phoneNumber: recipientPhone,
      displayName: recipientPhone,
    });
  }

  const conversation = await convRepo.findConversationByContactAndPhone(
    tenantId,
    phone.phoneNumberId,
    contact.id,
  );

  const windowExpiry = conversation?.customerServiceWindowExpiresAt;
  if (!windowExpiry || windowExpiry <= new Date()) {
    throw AppError.badRequest(
      'Cannot send media message: 24-hour customer service window is closed. Send an approved template message instead.',
      { code: 'WHATSAPP_CUSTOMER_SERVICE_WINDOW_EXPIRED' },
    );
  }

  const messageRecord = await messageRepo.createMessage({
    tenantId,
    phoneNumberId: phone.phoneNumberId,
    contactId: contact.id,
    conversationId: conversation!.id,
    direction: 'OUTBOUND',
    messageType: dto.type.toUpperCase() as WhatsAppMessageType,
    body: dto.media.caption || `[Media: ${dto.type}]`,
    payload: dto.media as unknown as Record<string, unknown>,
    internalStatus: 'QUEUED',
  });

  const { accessToken } = await getDecryptedAccountToken(tenantId);
  try {
    const res = await metaWhatsAppProvider.sendMediaMessage({
      phoneNumberId: phone.phoneNumberId,
      accessToken,
      to: recipientPhone,
      type: dto.type,
      media: dto.media,
    });

    const updated = await messageRepo.updateMessageStatus(tenantId, messageRecord.id, {
      providerMessageId: res.providerMessageId,
      internalStatus: 'ACCEPTED',
      acceptedAt: new Date(),
    });

    await convRepo.updateConversation(tenantId, conversation!.id, {
      lastMessageAt: new Date(),
    });

    return updated;
  } catch (err) {
    await messageRepo.updateMessageStatus(tenantId, messageRecord.id, {
      internalStatus: 'FAILED',
      failedAt: new Date(),
      errorCode: (err as { code?: string })?.code || 'WHATSAPP_MESSAGE_FAILED',
      errorMessage: (err as Error)?.message,
    });
    throw err;
  }
}
