import { Router, type NextFunction, type Request, type Response } from 'express';

import { env } from '@/config/env';
import { AppError } from '@/lib/errors';
import { LOCALES_METADATA } from '@/lib/i18n';
import { AppResponse } from '@/lib/responses';
import { validate } from '@/middleware/validate';
import addressRoutes from '@/modules/addresses/addresses.routes';
import { platformMetricsRouter } from '@/modules/analytics/analytics.routes';
import announcementsRoutes from '@/modules/announcements/announcements.routes';
import authRoutes from '@/modules/auth/auth.routes';
import * as billingController from '@/modules/billing/billing.controller';
import billingRoutes from '@/modules/billing/billing.routes';
import { platformChatRouter, tenantChatRouter } from '@/modules/chat/chat.routes';
import developersRoutes from '@/modules/developers/developers.routes';
import emailTemplateRoutes from '@/modules/email-templates/email-templates.routes';
import featureFlagsRoutes from '@/modules/feature-flags/feature-flags.routes';
import fileRoutes from '@/modules/files/files.routes';
import geoRoutes from '@/modules/geo/geo.routes';
import groupRoutes from '@/modules/groups/groups.routes';
import internalRoutes from '@/modules/internal/internal.routes';
import leadsRoutes from '@/modules/leads/leads.routes';
import maintenanceRoutes from '@/modules/maintenance/maintenance.routes';
import notificationsRoutes, {
  platformPushRouter,
} from '@/modules/notifications/notifications.routes';
import {
  isModuleInstalled,
  optionalModuleKeys,
  optionalModules,
  type OptionalModuleKey,
} from '@/modules/optional-modules/registry';
import platformRoutes from '@/modules/platform/platform.routes';
import policiesRoutes from '@/modules/policies/policies.routes';
import { consentRouter, platformPrivacyRouter } from '@/modules/privacy/privacy.routes';
import rbacRoutes from '@/modules/rbac/rbac.routes';
import { scimRouter } from '@/modules/scim/scim.routes';
import searchRoutes from '@/modules/search/search.routes';
import { ssoAuthRouter } from '@/modules/sso/sso.routes';
import { feedbackRouter, platformSupportRouter } from '@/modules/support/support.routes';
import tenantRoutes from '@/modules/tenants/tenants.routes';
import userRoutes from '@/modules/users/users.routes';
import * as whatsAppOtpController from '@/modules/whatsapp/controllers/whatsapp-otp.controller';
import { sendOtpSchema, verifyOtpSchema } from '@/modules/whatsapp/validators/whatsapp.dto';
import * as whatsAppWebhookController from '@/modules/whatsapp/webhooks/whatsapp-webhook.controller';
import whatsAppRoutes from '@/modules/whatsapp/whatsapp.routes';

const router: Router = Router();
const optionalRouters = { leads: leadsRoutes } satisfies Record<OptionalModuleKey, Router>;
router.use('/auth/sso', ssoAuthRouter);
router.use('/auth', authRoutes);
router.use('/scim/v2', scimRouter);
router.use('/users', userRoutes);
router.use('/files', fileRoutes);
router.use('/tenants', tenantRoutes);
router.use('/groups', groupRoutes);
router.use('/rbac', rbacRoutes);
router.use('/policies', policiesRoutes);
for (const key of optionalModuleKeys.filter(isModuleInstalled)) {
  router.use(optionalModules[key].mountPath, optionalRouters[key]);
}
router.use('/notifications', notificationsRoutes);
router.use('/search', searchRoutes);
router.use('/platform', platformRoutes);
router.use('/email-templates', emailTemplateRoutes);
router.use('/billing', billingRoutes);
router.use('/plans', billingRoutes);
router.post('/webhooks/razorpay', billingController.handleBillingWebhook);
router.get('/webhooks/whatsapp', whatsAppWebhookController.verifyWebhook);
router.post('/webhooks/whatsapp', whatsAppWebhookController.handleWebhook);
const requireWhatsAppOtpEnabled = (_req: Request, _res: Response, next: NextFunction) => {
  if (!env.ENABLE_WHATSAPP_AUTH_OTP) {
    throw new AppError(
      503,
      'WhatsApp OTP authentication is currently disabled.',
      'WHATSAPP_OTP_DISABLED',
    );
  }
  next();
};

router.post(
  '/auth/whatsapp/send-otp',
  requireWhatsAppOtpEnabled,
  validate({ body: sendOtpSchema }),
  whatsAppOtpController.sendOtp,
);
router.post(
  '/auth/whatsapp/verify-otp',
  requireWhatsAppOtpEnabled,
  validate({ body: verifyOtpSchema }),
  whatsAppOtpController.verifyOtp,
);
router.use('/tenant/whatsapp', whatsAppRoutes);
router.use('/whatsapp', whatsAppRoutes);
router.use('/internal', internalRoutes);
router.use('/developers', developersRoutes);
router.use('/feature-flags', featureFlagsRoutes);
router.use('/announcements', announcementsRoutes);
router.use('/platform/maintenance', maintenanceRoutes);
router.use('/platform/privacy', platformPrivacyRouter);
router.use('/platform/metrics', platformMetricsRouter);
router.use('/platform/support', platformSupportRouter);
router.use('/platform/notifications/push', platformPushRouter);
router.use('/platform/chat', platformChatRouter);
router.use('/chat', tenantChatRouter);
router.use('/consent', consentRouter);
router.use('/feedback', feedbackRouter);
router.use('/geo', geoRoutes);
router.use('/addresses', addressRoutes);
router.get('/public/plans', billingController.listPublicPlans);
router.get('/meta/locales', (_req, res) => {
  return AppResponse.ok(Object.values(LOCALES_METADATA)).send(res);
});

export default router;
