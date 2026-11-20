import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { authLimiter } from '@/middleware/rate-limit';
import { validate } from '@/middleware/validate';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as controller from './privacy.controller';
import * as dto from './privacy.dto';

// Consent router mounted at /api/v1/consent
export const consentRouter = Router();

consentRouter.use(requireAuth);

consentRouter.get('/status', controller.getConsentStatus);
consentRouter.post('/', validate({ body: dto.recordConsentDto }), controller.recordConsent);

// Platform Privacy & Legal Holds router mounted at /api/v1/platform/privacy
export const platformPrivacyRouter = Router();

platformPrivacyRouter.use(requirePlatformAuth);

platformPrivacyRouter.get(
  '/holds',
  requirePlatformPermission(PLATFORM_PERMISSIONS.LEGAL_HOLD_READ),
  controller.listLegalHolds,
);

platformPrivacyRouter.post(
  '/retention-sweep',
  requirePlatformPermission(PLATFORM_PERMISSIONS.PRIVACY_MANAGE),
  controller.triggerRetentionSweep,
);

platformPrivacyRouter.post(
  '/legal-documents',
  requirePlatformPermission(PLATFORM_PERMISSIONS.PRIVACY_MANAGE),
  validate({ body: dto.createLegalDocumentDto }),
  controller.upsertLegalDocument,
);
