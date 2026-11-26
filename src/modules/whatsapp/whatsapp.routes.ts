import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { resolveTenantContext } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as accountController from './controllers/whatsapp-account.controller';
import * as campaignController from './controllers/whatsapp-campaign.controller';
import * as contactController from './controllers/whatsapp-contact.controller';
import * as convController from './controllers/whatsapp-conversation.controller';
import * as messageController from './controllers/whatsapp-message.controller';
import * as templateController from './controllers/whatsapp-template.controller';
import * as usageController from './controllers/whatsapp-usage.controller';
import {
  completeOnboardingSchema,
  contactConsentSchema,
  conversationAssignmentSchema,
  conversationReplySchema,
  createCampaignSchema,
  createTemplateSchema,
  scheduleCampaignSchema,
  sendMediaMessageSchema,
  sendTemplateMessageSchema,
  sendTextMessageSchema,
  updatePhoneNumberSchema,
  updateTemplateSchema,
} from './validators/whatsapp.dto';
import { WHATSAPP_PERMISSIONS } from './whatsapp.permissions';

const router = Router();

// Apply Authentication and Tenant Resolution
router.use(requireAuth);
router.use(resolveTenantContext);

// --- Accounts & Onboarding ---
router.get(
  '/accounts',
  requirePermission(WHATSAPP_PERMISSIONS.ACCOUNT_READ),
  accountController.getAccount,
);
router.post(
  '/onboarding/session',
  requirePermission(WHATSAPP_PERMISSIONS.ACCOUNT_MANAGE),
  accountController.createOnboardingSession,
);
router.post(
  '/onboarding/complete',
  requirePermission(WHATSAPP_PERMISSIONS.ACCOUNT_MANAGE),
  validate({ body: completeOnboardingSchema }),
  accountController.completeOnboarding,
);
router.delete(
  '/accounts/:accountId',
  requirePermission(WHATSAPP_PERMISSIONS.ACCOUNT_MANAGE),
  accountController.disconnectAccount,
);
router.post(
  '/accounts/refresh',
  requirePermission(WHATSAPP_PERMISSIONS.ACCOUNT_MANAGE),
  accountController.refreshAccount,
);

// --- Phone Numbers ---
router.get(
  '/phone-numbers',
  requirePermission(WHATSAPP_PERMISSIONS.PHONE_NUMBER_READ),
  accountController.listPhoneNumbers,
);
router.patch(
  '/phone-numbers/:id',
  requirePermission(WHATSAPP_PERMISSIONS.PHONE_NUMBER_MANAGE),
  validate({ body: updatePhoneNumberSchema }),
  accountController.updatePhoneNumber,
);

// --- Templates ---
router.get(
  '/templates',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_READ),
  templateController.listTemplates,
);
router.post(
  '/templates',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_WRITE),
  validate({ body: createTemplateSchema }),
  templateController.createTemplate,
);
router.get(
  '/templates/:id',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_READ),
  templateController.getTemplate,
);
router.patch(
  '/templates/:id',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_WRITE),
  validate({ body: updateTemplateSchema }),
  templateController.updateTemplate,
);
router.post(
  '/templates/:id/submit',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_SUBMIT),
  templateController.submitTemplate,
);
router.post(
  '/templates/sync',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_WRITE),
  templateController.syncTemplates,
);
router.delete(
  '/templates/:id',
  requirePermission(WHATSAPP_PERMISSIONS.TEMPLATE_DELETE),
  templateController.deleteTemplate,
);

// --- Outbound Messages ---
router.post(
  '/messages/template',
  requirePermission(WHATSAPP_PERMISSIONS.MESSAGE_SEND),
  validate({ body: sendTemplateMessageSchema }),
  messageController.sendTemplateMessage,
);
router.post(
  '/messages/text',
  requirePermission(WHATSAPP_PERMISSIONS.MESSAGE_SEND),
  validate({ body: sendTextMessageSchema }),
  messageController.sendTextMessage,
);
router.post(
  '/messages/media',
  requirePermission(WHATSAPP_PERMISSIONS.MESSAGE_SEND),
  validate({ body: sendMediaMessageSchema }),
  messageController.sendMediaMessage,
);
router.get(
  '/messages',
  requirePermission(WHATSAPP_PERMISSIONS.MESSAGE_READ),
  messageController.listMessages,
);
router.get(
  '/messages/:id',
  requirePermission(WHATSAPP_PERMISSIONS.MESSAGE_READ),
  messageController.getMessage,
);

// --- Contacts & Consent ---
router.get(
  '/contacts',
  requirePermission(WHATSAPP_PERMISSIONS.CONTACT_READ),
  contactController.listContacts,
);
router.post(
  '/contacts',
  requirePermission(WHATSAPP_PERMISSIONS.CONTACT_MANAGE),
  contactController.createContact,
);
router.get(
  '/contacts/:id',
  requirePermission(WHATSAPP_PERMISSIONS.CONTACT_READ),
  contactController.getContact,
);
router.patch(
  '/contacts/:id/consent',
  requirePermission(WHATSAPP_PERMISSIONS.CONTACT_MANAGE),
  validate({ body: contactConsentSchema }),
  contactController.updateConsent,
);

// --- Customer Conversations & Inbox ---
router.get(
  '/conversations',
  requirePermission(WHATSAPP_PERMISSIONS.CONVERSATION_READ),
  convController.listConversations,
);
router.get(
  '/conversations/:id/messages',
  requirePermission(WHATSAPP_PERMISSIONS.CONVERSATION_READ),
  convController.getConversationMessages,
);
router.post(
  '/conversations/:id/reply',
  requirePermission(WHATSAPP_PERMISSIONS.CONVERSATION_REPLY),
  validate({ body: conversationReplySchema }),
  convController.replyToConversation,
);
router.patch(
  '/conversations/:id/assignment',
  requirePermission(WHATSAPP_PERMISSIONS.CONVERSATION_ASSIGN),
  validate({ body: conversationAssignmentSchema }),
  convController.assignConversation,
);

// --- Broadcast Campaigns ---
router.get(
  '/campaigns',
  requirePermission(WHATSAPP_PERMISSIONS.CAMPAIGN_READ),
  campaignController.listCampaigns,
);
router.post(
  '/campaigns',
  requirePermission(WHATSAPP_PERMISSIONS.CAMPAIGN_WRITE),
  validate({ body: createCampaignSchema }),
  campaignController.createCampaign,
);
router.get(
  '/campaigns/:id',
  requirePermission(WHATSAPP_PERMISSIONS.CAMPAIGN_READ),
  campaignController.getCampaign,
);
router.post(
  '/campaigns/:id/schedule',
  requirePermission(WHATSAPP_PERMISSIONS.CAMPAIGN_MANAGE),
  validate({ body: scheduleCampaignSchema }),
  campaignController.scheduleCampaign,
);
router.post(
  '/campaigns/:id/cancel',
  requirePermission(WHATSAPP_PERMISSIONS.CAMPAIGN_MANAGE),
  campaignController.cancelCampaign,
);

// --- Usage & Billing Analytics ---
router.get(
  '/usage/summary',
  requirePermission(WHATSAPP_PERMISSIONS.USAGE_READ),
  usageController.getUsageSummary,
);
router.get(
  '/usage/messages',
  requirePermission(WHATSAPP_PERMISSIONS.USAGE_READ),
  usageController.listUsageMessages,
);

export default router;
