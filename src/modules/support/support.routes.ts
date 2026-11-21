import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePlatformAuth, requirePlatformPermission } from '@/middleware/platform';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';
import { ONBOARDING_PERMISSIONS } from '@/modules/onboarding/onboarding.permissions';
import { PLATFORM_PERMISSIONS } from '@/modules/platform/platform.permissions';

import * as supportController from './support.controller';
import {
  addTicketMessageDto,
  createFeedbackDto,
  createTicketDto,
  updateTicketDto,
} from './support.dto';

// ─── Tenant Support Router ───────────────────────────────────────────────────

export const tenantSupportRouter = Router({ mergeParams: true });

tenantSupportRouter.use(requireAuth, requireTenant);

tenantSupportRouter.get(
  '/tickets',
  requirePermission(ONBOARDING_PERMISSIONS.SUPPORT_READ),
  supportController.listTickets,
);

tenantSupportRouter.post(
  '/tickets',
  requirePermission(ONBOARDING_PERMISSIONS.SUPPORT_CREATE),
  validate({ body: createTicketDto }),
  supportController.createTicket,
);

tenantSupportRouter.get(
  '/tickets/:ticketId',
  requirePermission(ONBOARDING_PERMISSIONS.SUPPORT_READ),
  supportController.getTicket,
);

tenantSupportRouter.post(
  '/tickets/:ticketId/messages',
  requirePermission(ONBOARDING_PERMISSIONS.SUPPORT_REPLY),
  validate({ body: addTicketMessageDto }),
  supportController.addMessage,
);

tenantSupportRouter.patch(
  '/tickets/:ticketId',
  requirePermission(ONBOARDING_PERMISSIONS.SUPPORT_CREATE),
  validate({ body: updateTicketDto }),
  supportController.updateTicket,
);

// ─── Feedback Router ─────────────────────────────────────────────────────────

export const feedbackRouter = Router();

feedbackRouter.post(
  '/',
  validate({ body: createFeedbackDto }),
  supportController.submitFeedback,
);

// ─── Platform Support Router ─────────────────────────────────────────────────

export const platformSupportRouter = Router();

platformSupportRouter.use(requirePlatformAuth);

platformSupportRouter.get(
  '/tickets',
  requirePlatformPermission(PLATFORM_PERMISSIONS.SUPPORT_TICKETS_READ),
  supportController.listPlatformTickets,
);

platformSupportRouter.get(
  '/feedback',
  requirePlatformPermission(PLATFORM_PERMISSIONS.FEEDBACK_READ),
  supportController.listFeedback,
);
