import type { Job } from 'bullmq';

import { logger } from '@/config/logger';
import type { WhatsAppMessageInternalStatus, WhatsAppMessageType } from '@/db/schema/enums';
import { runWithTenantDb } from '@/db/tenancy/context';
import { getTenantDb } from '@/db/tenancy/tenant-db';
import { emitToRoom } from '@/sockets/emitter';

import * as contactRepo from '../repositories/whatsapp-contact.repository';
import * as convRepo from '../repositories/whatsapp-conversation.repository';
import * as messageRepo from '../repositories/whatsapp-message.repository';
import * as templateRepo from '../repositories/whatsapp-template.repository';
import type { WhatsAppTemplateStatus } from '../types/whatsapp-provider.types';
import { normalizePhoneNumber } from '../utils/phone-number.util';
import { shouldUpdateMessageStatus } from '../utils/status-progression.util';

export interface WebhookJobData {
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  payload: Record<string, unknown>;
  routingKey?: string | null;
}

export async function processWhatsAppWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const { tenantId, phoneNumberId, payload } = job.data;
  const db = await getTenantDb(tenantId);

  await runWithTenantDb({ tenantId, db }, async () => {
    const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];

    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];

      for (const change of changes) {
        const value = change.value as Record<string, unknown> | undefined;
        if (!value) continue;

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

          let newInternalStatus: WhatsAppMessageInternalStatus | undefined;
          if (status === 'sent') {
            newInternalStatus = 'SENT';
          } else if (status === 'delivered') {
            newInternalStatus = 'DELIVERED';
          } else if (status === 'read') {
            newInternalStatus = 'READ';
          } else if (status === 'failed') {
            newInternalStatus = 'FAILED';
          }

          if (!newInternalStatus) {
            continue;
          }

          if (!shouldUpdateMessageStatus(message.internalStatus, newInternalStatus)) {
            logger.debug(
              {
                messageId: message.id,
                currentStatus: message.internalStatus,
                ignoredStatus: newInternalStatus,
              },
              'Ignored out-of-order or regressive WhatsApp delivery status update',
            );
            continue;
          }

          const patch: Record<string, unknown> = {
            providerStatus: status,
            internalStatus: newInternalStatus,
          };

          if (newInternalStatus === 'SENT') {
            patch.sentAt = timestamp;
          } else if (newInternalStatus === 'DELIVERED') {
            patch.deliveredAt = timestamp;
          } else if (newInternalStatus === 'READ') {
            patch.readAt = timestamp;
          } else if (newInternalStatus === 'FAILED') {
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

          // Emit real-time status update to tenant UI
          try {
            emitToRoom(`tenant:${tenantId}`, 'whatsapp:status:updated', {
              messageId: message.id,
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

          // Real-time broadcast to connected UI clients
          try {
            emitToRoom(`tenant:${tenantId}`, 'whatsapp:message:received', {
              conversationId: conv.id,
              message: savedMessage,
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

        if (eventType && (templateId || templateName)) {
          const templates = await templateRepo.listTemplates({ tenantId, search: templateName });
          const matched = templates.items.find(
            (t) => t.metaTemplateId === templateId || t.name === templateName,
          );

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
