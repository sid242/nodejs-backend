import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import * as contactRepo from '../repositories/whatsapp-contact.repository';
import * as convRepo from '../repositories/whatsapp-conversation.repository';
import * as messageRepo from '../repositories/whatsapp-message.repository';
import { sendTextMessage } from './whatsapp-message.service';

export async function listConversations(tenantId: string, status?: string, limit = 50, offset = 0) {
  const conversations = await convRepo.listConversations(tenantId, status, limit, offset);

  // Attach contact details
  const enriched = await Promise.all(
    conversations.map(async (conv) => {
      const contact = await contactRepo.findContactById(tenantId, conv.contactId);
      const isWindowOpen = conv.customerServiceWindowExpiresAt
        ? conv.customerServiceWindowExpiresAt > new Date()
        : false;

      return {
        ...conv,
        contactName: contact?.displayName || contact?.phoneNumber,
        contactPhone: contact?.phoneNumber,
        isWindowOpen,
      };
    }),
  );

  return enriched;
}

export async function getConversationMessages(
  tenantId: string,
  conversationId: string,
  limit = 50,
  offset = 0,
) {
  const conv = await convRepo.findConversationById(tenantId, conversationId);
  if (!conv) {
    throw AppError.notFound('Conversation not found');
  }

  const messages = await messageRepo.listMessages({
    tenantId,
    conversationId,
    limit,
    offset,
  });

  return messages;
}

export async function replyToConversation(
  tenantId: string,
  userId: string,
  conversationId: string,
  text: string,
) {
  const conv = await convRepo.findConversationById(tenantId, conversationId);
  if (!conv) {
    throw AppError.notFound('Conversation not found');
  }

  const contact = await contactRepo.findContactById(tenantId, conv.contactId);
  if (!contact) {
    throw AppError.notFound('Customer contact not found');
  }

  return sendTextMessage(tenantId, userId, {
    phoneNumberId: conv.phoneNumberId,
    to: contact.phoneNumber,
    text,
  });
}

export async function assignConversation(
  tenantId: string,
  userId: string,
  conversationId: string,
  staffId: string | null,
) {
  const conv = await convRepo.findConversationById(tenantId, conversationId);
  if (!conv) {
    throw AppError.notFound('Conversation not found');
  }

  const updated = await convRepo.updateConversation(tenantId, conversationId, {
    assignedStaffId: staffId,
  });

  await logSecurityEvent({
    tenantId,
    userId,
    action: 'whatsapp:conversation:assigned',
    entityType: 'whatsapp_conversation',
    entityId: conversationId,
    metadata: { assignedStaffId: staffId },
  });

  return updated;
}
