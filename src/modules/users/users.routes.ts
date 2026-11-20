import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rate-limit';
import { validate } from '@/middleware/validate';
import * as controller from '@/modules/users/users.controller';
import * as privacyController from '@/modules/privacy/privacy.controller';
import * as privacyDto from '@/modules/privacy/privacy.dto';
import {
  avatarUploadUrlDto,
  confirmEmailChangeDto,
  listLoginHistoryQueryDto,
  requestEmailChangeDto,
  updateMeDto,
} from '@/modules/users/users.dto';

const router = Router();
router.use(requireAuth);

router.get('/me', controller.getMe);
router.patch('/me', validate({ body: updateMeDto }), controller.updateMe);
router.get('/me/memberships', controller.getMemberships);
router.get('/me/login-history', validate({ query: listLoginHistoryQueryDto }), controller.getLoginHistory);
router.post('/me/avatar-upload-url', validate({ body: avatarUploadUrlDto }), controller.getAvatarUploadUrl);

router.post(
  '/me/email-change/request',
  authLimiter,
  validate({ body: requestEmailChangeDto }),
  controller.requestEmailChange,
);

router.post(
  '/me/email-change/confirm',
  authLimiter,
  validate({ body: confirmEmailChangeDto }),
  controller.confirmEmailChange,
);

// GDPR / DPDP Privacy & Data Subject Access Request (DSAR)
router.post('/me/data-export', privacyController.requestUserDataExport);
router.get('/me/data-exports', privacyController.listUserDataExports);
router.post(
  '/me/delete-request',
  authLimiter,
  validate({ body: privacyDto.requestAccountDeletionDto }),
  privacyController.requestAccountDeletion,
);
router.post(
  '/me/delete-request/cancel',
  validate({ body: privacyDto.cancelAccountDeletionDto }),
  privacyController.cancelAccountDeletion,
);
router.get('/me/delete-request', privacyController.getAccountDeletionStatus);

export default router;
