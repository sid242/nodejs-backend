import type { Job } from 'bullmq';

import { logger } from '@/config/logger';
import type { WhatsAppMessageType } from '@/db/schema/enums';
import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/db/tenancy/tenant-db';
import { emitToRoom } from '@/sockets/emitter';

import * as contactRepo from '../repositories/whatsapp-contact.repository';
import * as convRepo from '../repositories/whatsapp-conversation.repository';
import * as messageRepo from '../repositories/whatsapp-message.repository';
import * as templateRepo from '../repositories/whatsapp-template.repository';
import type { WhatsAppTemplateStatus } from '../types/whatsapp-provider.types';
import { normalizePhoneNumber } from '../utils/phone-number.util';

export interface WebhookJobData {
  tenantId: string;
  wabaId: string;
  phoneNumberId?: string;
  payload: Record<string, unknown>;
  routingKey?: string | null;
}

export async function processWhatsAppWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const { tenantId, phoneNumberId: defaultPhoneId, payload } = job.data;
  const db = await getTenantDb(tenantId);

  await runWithTenantDb({ tenantId, db }, async () => {
    const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];

    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];

      for (const change of changes) {
        const value = change.value as Record<string, unknown> | undefined;
        if (!value) continue;

        const meta = value.metadata as Record<string, unknown> | undefined;
        const phoneNumberId = String(meta?.phone_number_id ?? defaultPhoneId ?? '');

        // 1. Process Delivery Status Updates (SENT, DELIVERED, READ, FAILED)
        const statuses = (value.statuses as Array<Record<string, unknown>>) ?? [];
        for (const statusObj of statuses) {
          const wamid = String(statusObj.id ?? '');
          const status = String(statusObj.status ?? '').toLowerCase();
          const timestamp = statusObj.timestamp
            ? new Date(Number(statusObj.timestamp) * 1000)
            : new Date();

          const message = await messageRepo.findMessageByProviderId(tenantId, wamid);
          if (!message) {
            continue;
          }

          const patch: Record<string, unknown> = {
            providerStatus: status,
          };

          if (status === 'sent') {
            patch.internalStatus = 'SENT';
            patch.sentAt = timestamp;
          } else if (status === 'delivered') {
            patch.internalStatus = 'DELIVERED';
            patch.deliveredAt = timestamp;
          } else if (status === 'read') {
            patch.internalStatus = 'READ';
            patch.readAt = timestamp;
          } else if (status === 'failed') {
            patch.internalStatus = 'FAILED';
            patch.failedAt = timestamp;
            const errors = (statusObj.errors as Array<Record<string, unknown>>) ?? [];
            if (errors[0]) {
              patch.errorCode = String(errors[0].code ?? 'WHATSAPP_DELIVERY_FAILED');
              patch.errorMessage = String(
                errors[0].message ?? errors[0].title ?? 'Delivery failed',
              );
            }
          }

          await messageRepo.updateMessageStatus(tenantId, message.id, patch);

          // Emit real-time status update to dedicated tenant WhatsApp room
          try {
            emitToRoom(`tenant:${tenantId}:whatsapp`, 'whatsapp:status:updated', {
              messageId: message.id,
              conversationId: message.conversationId,
              providerMessageId: wamid,
              status,
            });
          } catch {
            /* non-blocking socket emit */
          }
        }

        // 2. Process Inbound Customer Messages
        const messages = (value.messages as Array<Record<string, unknown>>) ?? [];
        for (const msgObj of messages) {
          const wamid = String(msgObj.id ?? '');
          const fromRaw = String(msgObj.from ?? '');
          const fromPhone = normalizePhoneNumber(fromRaw);
          const msgType = String(msgObj.type ?? 'text').toLowerCase();
          const timestamp = msgObj.timestamp
            ? new Date(Number(msgObj.timestamp) * 1000)
            : new Date();

          // Idempotency check: don't process same inbound message twice
          const existing = await messageRepo.findMessageByProviderId(tenantId, wamid);
          if (existing) {
            continue;
          }

          // Resolve contact
          let contact = await contactRepo.findContactByPhoneNumber(tenantId, fromPhone);
          if (!contact) {
            const contactsMeta = (value.contacts as Array<Record<string, unknown>>) ?? [];
            const contactProfile = contactsMeta.find((c) => String(c.wa_id) === fromRaw);
            const profile = contactProfile?.profile as Record<string, unknown> | undefined;

            contact = await contactRepo.createContact({
              tenantId,
              phoneNumber: fromPhone,
              waId: fromRaw,
              displayName: String(profile?.name || fromPhone),
            });
          }

          // Resolve or create conversation
          let conv = await convRepo.findConversationByContactAndPhone(
            tenantId,
            phoneNumberId,
            contact.id,
          );

          const now = new Date();
          // Meta 24-hour Customer Service Window opens on every inbound message
          const windowExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

          if (!conv) {
            conv = await convRepo.createConversation({
              tenantId,
              phoneNumberId,
              contactId: contact.id,
              status: 'OPEN',
              lastInboundMessageAt: now,
              customerServiceWindowExpiresAt: windowExpiry,
              lastMessageAt: now,
              unreadCount: 1,
            });
          } else {
            await convRepo.updateConversation(tenantId, conv.id, {
              lastInboundMessageAt: now,
              customerServiceWindowExpiresAt: windowExpiry,
              lastMessageAt: now,
              unreadCount: (conv.unreadCount ?? 0) + 1,
              status: 'OPEN',
            });
          }

          // Extract Body
          let bodyText: string = `[${msgType}]`;
          if (msgType === 'text') {
            bodyText = String((msgObj.text as Record<string, unknown>)?.body ?? '');
          } else if (msgType === 'button') {
            bodyText = String((msgObj.button as Record<string, unknown>)?.text ?? '');
          } else if (msgType === 'interactive') {
            const interactive = msgObj.interactive as Record<string, unknown> | undefined;
            const reply = (interactive?.button_reply || interactive?.list_reply) as
              Record<string, unknown> | undefined;
            bodyText = String(reply?.title || reply?.id || '[Interactive Reply]');
          }

          // Store Inbound Message Record
          const savedMessage = await messageRepo.createMessage({
            tenantId,
            phoneNumberId,
            contactId: contact.id,
            conversationId: conv.id,
            direction: 'INBOUND',
            messageType: msgType.toUpperCase() as WhatsAppMessageType,
            providerMessageId: wamid,
            body: bodyText,
            payload: msgObj,
            internalStatus: 'DELIVERED',
            deliveredAt: timestamp,
          });

          // Process inbound opt-out keywords (W6: STOP, UNSUBSCRIBE, CANCEL, QUIT, END, ROK)
          const trimmedUpper = bodyText.trim().toUpperCase();
          const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END', 'ROK'];
          if (OPT_OUT_KEYWORDS.includes(trimmedUpper)) {
            await contactRepo.optOutContact(
              tenantId,
              contact.id,
              `Inbound opt-out keyword '${trimmedUpper}' via message ${wamid}`,
            );
            logger.info(
              { tenantId, contactId: contact.id, keyword: trimmedUpper },
              'WhatsApp contact opted out via inbound keyword',
            );
          }

          // Real-time broadcast to connected UI clients in dedicated whatsapp room
          // Minimal event: conversationId, unreadCount, and contact summary (NO body, NO raw payload)
          try {
            emitToRoom(`tenant:${tenantId}:whatsapp`, 'whatsapp:message:received', {
              conversationId: conv.id,
              messageId: savedMessage.id,
              phoneNumberId,
              direction: 'INBOUND',
              messageType: savedMessage.messageType,
              createdAt: savedMessage.createdAt,
              unreadCount: conv.unreadCount ?? 1,
              contact: {
                id: contact.id,
                name: contact.displayName,
                phoneNumber: contact.phoneNumber,
              },
            });
          } catch {
            /* non-blocking socket emit */
          }
        }

        // 3. Process Template Status Changes (e.g. APPROVED, REJECTED)
        const eventType = String(value.event ?? '');
        const templateId = String(value.message_template_id ?? '');
        const templateName = String(value.message_template_name ?? '');
        const templateLang = String(value.message_template_language ?? value.language ?? '');

        if (eventType && (templateId || templateName)) {
          const templates = await templateRepo.listTemplates({ tenantId, search: templateName });
          const matched = templates.items.find((t) => {
            if (templateId && t.metaTemplateId === templateId) return true;
            if (templateName && t.name === templateName) {
              if (templateLang && t.language) {
                return t.language === templateLang;
              }
              return true;
            }
            return false;
          });

          if (matched) {
            const statusMap: Record<string, WhatsAppTemplateStatus> = {
              APPROVED: 'APPROVED',
              REJECTED: 'REJECTED',
              PAUSED: 'PAUSED',
              DISABLED: 'DISABLED',
            };
            const mappedStatus = statusMap[eventType.toUpperCase()] ?? 'PENDING';

            await templateRepo.updateTemplate(tenantId, matched.id, {
              status: mappedStatus,
              metaTemplateId: templateId || matched.metaTemplateId,
              rejectionReason: value.reason ? String(value.reason) : null,
              lastSyncedAt: new Date(),
            });

            logger.info(
              { templateName, status: mappedStatus, tenantId },
              'Updated WhatsApp template status from Meta webhook event',
            );
          }
        }
      }
    }
  });
}
