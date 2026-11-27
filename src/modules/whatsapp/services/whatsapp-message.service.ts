import type {
  WhatsAppConsentPurpose,
  WhatsAppContactConsentRecord,
  WhatsAppMessageType,
} from '@/db/schema';
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
import { calculateEstimatedCost } from '../utils/rate-card.util';
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

export function assertMessageConsent(
  category: string,
  consent?: WhatsAppContactConsentRecord,
  recipientPhone?: string,
): void {
  const phoneText = recipientPhone ? `Recipient ${recipientPhone}` : 'Recipient';
  if (category === 'MARKETING') {
    if (consent?.status !== 'OPTED_IN') {
      throw AppError.badRequest(
        `${phoneText} has not opted in to MARKETING messages. Explicit opt-in consent is required.`,
        { code: 'WHATSAPP_MARKETING_OPT_IN_REQUIRED' },
      );
    }
  } else {
    // UTILITY and AUTHENTICATION templates are permitted unless explicitly OPTED_OUT
    if (consent?.status === 'OPTED_OUT') {
      throw AppError.badRequest(`${phoneText} has opted out of ${category} messages`, {
        code: 'WHATSAPP_CONSENT_REQUIRED',
      });
    }
  }
}

export interface RenderedTemplateSnapshot {
  name: string;
  language: string;
  header?: { format?: string; text?: string };
  body?: string;
  footer?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
}

function substituteTemplateVariables(
  text: string,
  parameters?: TemplateComponentInput['parameters'],
): string {
  if (!parameters?.length) return text;
  return text.replace(/\{\{(\d+)\}\}/g, (match, indexStr: string) => {
    const idx = Number(indexStr) - 1;
    const param = parameters[idx];
    return param?.text ?? match;
  });
}

export function buildRenderedTemplateSnapshot(
  templateName: string,
  language: string,
  definitionComponents: Array<Record<string, unknown>> | undefined,
  sentComponents: TemplateComponentInput[] | undefined,
): { bodyText: string; snapshot: RenderedTemplateSnapshot } {
  const comps = definitionComponents ?? [];
  const headerDef = comps.find((c) => c.type === 'HEADER');
  const bodyDef = comps.find((c) => c.type === 'BODY');
  const footerDef = comps.find((c) => c.type === 'FOOTER');
  const buttonsDef = comps.find((c) => c.type === 'BUTTONS');

  const headerParams = sentComponents?.find((c) => c.type === 'header')?.parameters;
  const bodyParams = sentComponents?.find((c) => c.type === 'body')?.parameters;

  const headerText =
    typeof headerDef?.text === 'string'
      ? substituteTemplateVariables(headerDef.text, headerParams)
      : undefined;
  const bodyText =
    typeof bodyDef?.text === 'string' ? substituteTemplateVariables(bodyDef.text, bodyParams) : '';
  const footerText = typeof footerDef?.text === 'string' ? footerDef.text : undefined;
  const buttons = Array.isArray(buttonsDef?.buttons)
    ? (buttonsDef.buttons as Array<{
        type: string;
        text: string;
        url?: string;
        phone_number?: string;
      }>)
    : undefined;

  const snapshot: RenderedTemplateSnapshot = {
    name: templateName,
    language,
    ...(headerDef
      ? {
          header: {
            format: typeof headerDef.format === 'string' ? headerDef.format : 'TEXT',
            ...(headerText ? { text: headerText } : {}),
          },
        }
      : {}),
    ...(bodyText ? { body: bodyText } : {}),
    ...(footerText ? { footer: footerText } : {}),
    ...(buttons?.length ? { buttons } : {}),
  };

  return {
    bodyText: bodyText || headerText || `[Template: ${templateName}]`,
    snapshot,
  };
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

  // 3. Resolve sending phone number (never silently switch if specific ID requested)
  let phone;
  if (dto.phoneNumberId) {
    phone = await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId);
    if (!phone) {
      throw new AppError(
        400,
        `Requested WhatsApp phone number ID '${dto.phoneNumberId}' was not found for this tenant`,
        'WHATSAPP_PHONE_NUMBER_NOT_FOUND',
      );
    }
  } else {
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
    (template.category === 'MARKETING'
      ? 'MARKETING'
      : template.category === 'AUTHENTICATION'
        ? 'AUTHENTICATION'
        : 'TRANSACTIONAL') as WhatsAppConsentPurpose,
  );

  assertMessageConsent(template.category, consent, recipientPhone);

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
  const { bodyText: renderedBody, snapshot: renderedSnapshot } = buildRenderedTemplateSnapshot(
    template.name,
    language,
    template.components as Array<Record<string, unknown>> | undefined,
    dto.template.components,
  );

  const messageRecord = await messageRepo.createMessage({
    tenantId,
    phoneNumberId: phone.phoneNumberId,
    contactId: contact.id,
    conversationId: conversation.id,
    direction: 'OUTBOUND',
    messageType: 'TEMPLATE',
    templateId: template.id,
    idempotencyKey: dto.idempotencyKey || null,
    body: renderedBody,
    payload: {
      ...(dto.template as unknown as Record<string, unknown>),
      rendered: renderedSnapshot,
    },
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

    // 11. Record billable usage estimate from versioned rate card
    const country = getCountryFromPhoneNumber(recipientPhone);
    const { estimatedCost, currency, rateCardVersion } = calculateEstimatedCost(
      template.category,
      country,
    );
    await usageRepo.recordUsage({
      tenantId,
      wabaId: template.businessAccountId,
      phoneNumberId: phone.phoneNumberId,
      recipientCountry: country,
      templateCategory: template.category,
      providerMessageId: sendResult.providerMessageId,
      deliveryStatus: 'ACCEPTED',
      pricingRateCardVersion: rateCardVersion,
      estimatedCost,
      currency,
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
  // 1. Idempotency Check
  if (dto.idempotencyKey) {
    const existing = await messageRepo.findMessageByIdempotencyKey(tenantId, dto.idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  const recipientPhone = normalizePhoneNumber(dto.to);

  // Resolve Phone (reject invalid requested number)
  let phone;
  if (dto.phoneNumberId) {
    phone = await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId);
    if (!phone) {
      throw new AppError(
        400,
        `Requested WhatsApp phone number ID '${dto.phoneNumberId}' was not found for this tenant`,
        'WHATSAPP_PHONE_NUMBER_NOT_FOUND',
      );
    }
  } else {
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
    idempotencyKey: dto.idempotencyKey || null,
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
  // 1. Idempotency Check
  if (dto.idempotencyKey) {
    const existing = await messageRepo.findMessageByIdempotencyKey(tenantId, dto.idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  // 2. Validate media link protocol if external link supplied
  if (dto.media?.link) {
    try {
      const url = new URL(dto.media.link);
      if (url.protocol !== 'https:') {
        throw new Error('Not https');
      }
    } catch {
      throw new AppError(
        400,
        'Media URL must use secure https:// protocol',
        'WHATSAPP_INVALID_MEDIA_URL',
      );
    }
  }

  const recipientPhone = normalizePhoneNumber(dto.to);

  // Resolve Phone (reject invalid requested number)
  let phone;
  if (dto.phoneNumberId) {
    phone = await accountRepo.findPhoneNumberByProviderId(tenantId, dto.phoneNumberId);
    if (!phone) {
      throw new AppError(
        400,
        `Requested WhatsApp phone number ID '${dto.phoneNumberId}' was not found for this tenant`,
        'WHATSAPP_PHONE_NUMBER_NOT_FOUND',
      );
    }
  } else {
    const numbers = await accountRepo.listPhoneNumbers(tenantId);
    phone = numbers.find((n) => n.isDefault) || numbers[0];
  }
  if (!phone || !phone.isEnabled) {
    throw AppError.badRequest('No active WhatsApp phone number available', {
      code: 'WHATSAPP_PHONE_NUMBER_DISABLED',
    });
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
    idempotencyKey: dto.idempotencyKey || null,
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
