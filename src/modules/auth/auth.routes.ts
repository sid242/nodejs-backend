import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import { ACCESS_TOKEN_COOKIE, AUTH_HEADERS, PLATFORM_STAFF_TOKEN_COOKIE } from '@/constants/index';
import { AppError } from '@/lib/errors';
import { optionalAuth, requireAuth } from '@/middleware/auth';
import { authLimiter, handoffRedeemLimiter } from '@/middleware/rate-limit';
import { blockInSupportSession } from '@/middleware/support';
import { validate } from '@/middleware/validate';
import * as controller from '@/modules/auth/auth.controller';
import {
  changePasswordDto,
  createHandoffDto,
  disableTwoFactorDto,
  enableTwoFactorDto,
  forgotPasswordDto,
  impersonateUserDto,
  loginDto,
  redeemHandoffDto,
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
import { verifyAccessToken } from '@/modules/auth/tokens';

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
router.use(authLimiter);

async function requireCallerAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith(AUTH_HEADERS.PREFIX)) {
    token = header.slice(AUTH_HEADERS.PREFIX.length).trim();
  } else if (req.cookies?.[PLATFORM_STAFF_TOKEN_COOKIE]) {
    token = req.cookies[PLATFORM_STAFF_TOKEN_COOKIE];
  } else if (req.cookies?.[ACCESS_TOKEN_COOKIE]) {
    token = req.cookies[ACCESS_TOKEN_COOKIE];
  }

  if (!token) return next(AppError.unauthorized('Authentication required'));

  try {
    const decoded = jwt.verify(token, env.JWT_PLATFORM_SECRET, { audience: 'platform-api' }) as any;
    if (decoded?.typ === 'STAFF') {
      req.staff = {
        id: decoded.sub,
        email: decoded.email,
        displayName: decoded.displayName,
        roleId: decoded.roleId,
        roleKey: decoded.roleKey,
        permissions: decoded.permissions ?? [],
      };
      return next();
    }
  } catch {
    // Continue to user access token check
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload?.typ === 'USER') {
      req.user = { id: payload.sub as string };
      return next();
    }
  } catch {
    // Both checks failed
  }

  return next(AppError.unauthorized('Invalid or expired authentication credentials'));
}

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

// --- Session Handoff ---
router.post(
  '/handoff',
  requireAuth,
  validate({ body: createHandoffDto }),
  controller.createHandoff,
);
router.post(
  '/handoff/redeem',
  handoffRedeemLimiter,
  validate({ body: redeemHandoffDto }),
  controller.redeemHandoff,
);

// --- Impersonation ---
router.post(
  '/impersonate',
  requireCallerAuth,
  validate({ body: impersonateUserDto }),
  controller.impersonate,
);
router.post('/stop-impersonate', requireAuth, controller.stopImpersonate);

export default router;
