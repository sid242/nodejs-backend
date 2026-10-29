import { Router } from 'express';

import { optionalAuth, requireAuth } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rate-limit';
import { requirePermission } from '@/middleware/rbac';
import { blockInSupportSession } from '@/middleware/support';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as controller from './invitations.controller';
import * as dto from './invitations.dto';

const router: Router = Router({ mergeParams: true });

// ==========================================
// Public Invitation Endpoints
// ==========================================
router.get(
  '/preview',
  optionalAuth,
  validate({ query: dto.previewInvitationQueryDto }),
  controller.previewInvitation,
);

router.post(
  '/accept',
  optionalAuth,
  authLimiter,
  validate({ body: dto.acceptInvitationDto }),
  controller.acceptInvitation,
);

// ==========================================
// Tenant-Scoped Invitation Management
// ==========================================
router.post(
  '/',
  requireAuth,
  requireTenant,
  blockInSupportSession('Member invitation'),
  requirePermission('members:invite'),
  validate({ body: dto.createInvitationDto }),
  controller.createInvitation,
);

router.get(
  '/',
  requireAuth,
  requireTenant,
  requirePermission('members:read'),
  controller.listInvitations,
);

router.delete(
  '/:invId',
  requireAuth,
  requireTenant,
  requirePermission('members:invite'),
  controller.revokeInvitation,
);

router.post(
  '/:invId/resend',
  requireAuth,
  requireTenant,
  requirePermission('members:invite'),
  controller.resendInvitation,
);

export const invitationsRouter = router;
