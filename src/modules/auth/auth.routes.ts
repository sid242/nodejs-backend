import { Router } from 'express';

import { optionalAuth, requireAuth, requireRole } from '@/middleware/auth.js';
import { blockIfImpersonating } from '@/middleware/impersonate-guard.js';
import { authLimiter } from '@/middleware/rate-limit.js';
import { validate } from '@/middleware/validate.js';
import * as controller from '@/modules/auth/auth.controller.js';
import {
  changePasswordDto,
  forgotPasswordDto,
  impersonateUserDto,
  loginDto,
  refreshTokenDto,
  registerDto,
  requestEmailVerificationDto,
  resetPasswordDto,
  verifyEmailDto,
} from '@/modules/auth/auth.dto.js';

const router = Router();
router.use(authLimiter);

router.post('/register', validate({ body: registerDto }), controller.register);
router.post('/login', validate({ body: loginDto }), controller.login);
router.post('/refresh', validate({ body: refreshTokenDto }), controller.refresh);
router.post('/logout', validate({ body: refreshTokenDto }), controller.logout);
router.post('/forgot-password', validate({ body: forgotPasswordDto }), controller.forgotPassword);
router.post('/reset-password', validate({ body: resetPasswordDto }), controller.resetPassword);
router.post(
  '/change-password',
  requireAuth,
  blockIfImpersonating('Change Password'),
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
router.delete('/sessions/:sessionId', requireAuth, controller.revokeSession);

// --- Controlled Impersonation ---
router.post(
  '/impersonate',
  requireAuth,
  blockIfImpersonating('Impersonation'),
  requireRole('ADMIN'),
  validate({ body: impersonateUserDto }),
  controller.impersonate,
);
router.post('/stop-impersonate', requireAuth, controller.stopImpersonation);

export default router;
