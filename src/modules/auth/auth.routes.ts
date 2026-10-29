import { Router } from 'express';

import { optionalAuth, requireAuth } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rate-limit';
import { blockInSupportSession } from '@/middleware/support';
import { validate } from '@/middleware/validate';
import * as controller from '@/modules/auth/auth.controller';
import {
  changePasswordDto,
  disableTwoFactorDto,
  enableTwoFactorDto,
  forgotPasswordDto,
  loginDto,
  refreshTokenDto,
  registerDto,
  requestEmailVerificationDto,
  requestMagicLinkDto,
  resetPasswordDto,
  revokeSessionParamsDto,
  verifyEmailDto,
  verifyMagicLinkDto,
  verifyTwoFactorChallengeDto,
} from '@/modules/auth/auth.dto';

const router = Router();
router.use(authLimiter);

router.post('/register', validate({ body: registerDto }), controller.register);
router.post('/login', validate({ body: loginDto }), controller.login);
router.post(
  '/magic-link/request',
  validate({ body: requestMagicLinkDto }),
  controller.requestMagicLink,
);
router.post(
  '/magic-link/verify',
  validate({ body: verifyMagicLinkDto }),
  controller.verifyMagicLink,
);
router.post('/refresh', validate({ body: refreshTokenDto }), controller.refresh);
router.post('/logout', validate({ body: refreshTokenDto }), controller.logout);
router.post('/forgot-password', validate({ body: forgotPasswordDto }), controller.forgotPassword);
router.post('/reset-password', validate({ body: resetPasswordDto }), controller.resetPassword);
router.post(
  '/change-password',
  requireAuth,
  blockInSupportSession('Change Password'),
  validate({ body: changePasswordDto }),
  controller.changePassword,
);
router.post(
  '/verify-email/request',
  optionalAuth,
  validate({ body: requestEmailVerificationDto }),
  controller.requestEmailVerification,
);
router.post('/verify-email/confirm', validate({ body: verifyEmailDto }), controller.verifyEmail);

// --- Active Device Sessions Management ---
router.get('/sessions', requireAuth, controller.listSessions);
router.delete(
  '/sessions/:sessionId',
  requireAuth,
  validate({ params: revokeSessionParamsDto }),
  controller.revokeSession,
);

// --- Two-Factor Authentication ---
router.post(
  '/2fa/setup',
  requireAuth,
  blockInSupportSession('2FA Setup'),
  controller.setupTwoFactor,
);
router.post(
  '/2fa/enable',
  requireAuth,
  blockInSupportSession('2FA Enable'),
  validate({ body: enableTwoFactorDto }),
  controller.enableTwoFactor,
);
router.post(
  '/2fa/disable',
  requireAuth,
  blockInSupportSession('2FA Disable'),
  validate({ body: disableTwoFactorDto }),
  controller.disableTwoFactor,
);
router.post(
  '/2fa/verify',
  validate({ body: verifyTwoFactorChallengeDto }),
  controller.verifyTwoFactorChallenge,
);
router.get('/2fa/status', requireAuth, controller.getTwoFactorStatus);

export default router;
