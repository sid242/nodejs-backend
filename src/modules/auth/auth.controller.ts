import type { Request, Response } from 'express';

import { REFRESH_TOKEN_COOKIE } from '@/constants/index';
import { asyncHandler } from '@/lib/async-handler';
import { AppError } from '@/lib/errors';
import { AppResponse } from '@/lib/responses';
import * as service from '@/modules/auth/auth.service';
import { clearAuthCookies, setAuthCookies } from '@/modules/auth/cookies';
import * as sessionsRepo from '@/modules/auth/sessions.repository';
import { revokeRefreshToken } from '@/modules/auth/tokens';
import * as twoFactorService from '@/modules/auth/two-factor.service';

function extractClientContext(req: Request): service.ClientContext {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
  const userAgent = req.headers['user-agent'];
  return {
    ip: ip || undefined,
    userAgent: userAgent || undefined,
    country: (req.headers['cf-ipcountry'] || req.headers['x-country']) as string | undefined,
    city: (req.headers['cf-ipcity'] || req.headers['x-city']) as string | undefined,
    deviceName: (req.headers['x-device-name'] as string) || undefined,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.valid?.body, extractClientContext(req));
  setAuthCookies(res, result);
  AppResponse.created(result, 'Registered').send(res);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.login(req.valid?.body, extractClientContext(req));

  // If 2FA is required, return the challenge (no cookies set)
  if ('twoFactorRequired' in result && result.twoFactorRequired) {
    AppResponse.ok(result, 'Two-factor authentication required').send(res);
    return;
  }

  setAuthCookies(res, result as any);
  AppResponse.ok(result, 'Logged in').send(res);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.valid?.body?.refreshToken ?? req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (!token) {
    throw AppError.unauthorized('Refresh token is required');
  }
  const result = await service.refresh(token, extractClientContext(req));
  setAuthCookies(res, result);
  AppResponse.ok(result, 'Token refreshed').send(res);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.valid?.body?.refreshToken ?? req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (token) {
    await revokeRefreshToken(token);
  }
  clearAuthCookies(res);
  res.status(204).end();
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.forgotPassword(req.valid?.body);
  AppResponse.ok(result).send(res);
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.resetPassword(req.valid?.body);
  clearAuthCookies(res);
  AppResponse.ok(result).send(res);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw AppError.unauthorized();
  }
  const result = await service.changePassword(req.user.id, req.valid?.body);
  AppResponse.ok(result, 'Password changed successfully.').send(res);
});

export const requestEmailVerification = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestEmailVerification({
    userId: req.user?.id,
    email: req.valid?.body?.email,
  });
  AppResponse.ok(result, result?.message ?? 'Verification email sent').send(res);
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.verifyEmail(req.valid?.body);
  AppResponse.ok(result, result?.message ?? 'Email verified successfully').send(res);
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const activeSessions = await sessionsRepo.findUserActiveSessions(req.user!.id);
  const clientCtx = extractClientContext(req);

  // Format sessions and determine current session
  const formatted = activeSessions.map((s, idx) => ({
    id: s.id,
    userId: s.userId,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    deviceName: s.deviceName,
    country: s.country,
    city: s.city,
    deviceType: s.deviceType,
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    // First session or matching IP/UA is marked as current
    isCurrent: idx === 0 || (s.ipAddress === clientCtx.ip && s.userAgent === clientCtx.userAgent),
  }));

  AppResponse.ok(formatted).send(res);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const success = await sessionsRepo.revokeSessionById(String(req.params.sessionId), req.user!.id);
  if (!success) throw AppError.notFound('Session not found');
  AppResponse.ok({ message: 'Session revoked successfully' }).send(res);
});

export const revokeOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  const currentSessionId = req.valid?.body?.currentSessionId;
  const result = await service.revokeOtherSessions(req.user!.id, currentSessionId);
  AppResponse.ok(result, result.message).send(res);
});

export const requestMagicLink = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestMagicLink(req.valid!.body.email);
  AppResponse.ok(result, result.message).send(res);
});

export const verifyMagicLink = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.verifyMagicLink(req.valid!.body.token);
  AppResponse.ok(result, 'Authenticated successfully via magic link').send(res);
});

// ─── Two-Factor Authentication ──────────────────────────────────────────────────

export const setupTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw AppError.unauthorized();
  const result = await twoFactorService.setupTwoFactor(req.user.id);
  AppResponse.ok(result, 'Scan the QR code with your authenticator app').send(res);
});

export const enableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw AppError.unauthorized();
  const result = await twoFactorService.enableTwoFactor(req.user.id, req.valid?.body?.code);
  AppResponse.ok(result, result.message).send(res);
});

export const disableTwoFactor = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw AppError.unauthorized();
  const { password, code } = req.valid?.body ?? {};
  const result = await twoFactorService.disableTwoFactor(req.user.id, password, code);
  AppResponse.ok(result, result.message).send(res);
});

export const verifyTwoFactorChallenge = asyncHandler(async (req: Request, res: Response) => {
  const { challengeToken, code } = req.valid?.body ?? {};
  const result = await twoFactorService.verifyTwoFactorChallenge(
    challengeToken,
    code,
    extractClientContext(req),
  );
  setAuthCookies(res, result);
  AppResponse.ok(result, 'Two-factor authentication verified').send(res);
});

export const getTwoFactorStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw AppError.unauthorized();
  const result = await twoFactorService.getTwoFactorStatus(req.user.id);
  AppResponse.ok(result).send(res);
});

export const regenerateRecoveryCodes = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw AppError.unauthorized();
  const result = await twoFactorService.regenerateRecoveryCodes(req.user.id, req.valid?.body ?? {});
  AppResponse.ok(result, result.message).send(res);
});

// ─── Session Handoff ────────────────────────────────────────────────────────────

export const createHandoff = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) throw AppError.unauthorized();
  const result = await service.createHandoff(req.user.id, req.valid!.body);
  AppResponse.ok(result, 'Handoff code created').send(res);
});

export const redeemHandoff = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.redeemHandoff(req.valid!.body);
  setAuthCookies(res, result);
  AppResponse.ok(result, 'Handoff code redeemed successfully').send(res);
});

// ─── Impersonation ─────────────────────────────────────────────────────────────

export const impersonate = asyncHandler(async (req: Request, res: Response) => {
  const callerId = req.staff?.id ?? req.user?.id;
  const callerType: 'STAFF' | 'USER' = req.staff ? 'STAFF' : 'USER';

  if (!callerId) {
    throw AppError.unauthorized('Authentication required to impersonate');
  }

  const { targetUserId, reason, durationMinutes } = req.valid!.body;
  const result = await service.impersonateUser({
    caller: { id: callerId, type: callerType },
    targetUserId,
    reason,
    durationMinutes,
  });

  AppResponse.ok(result, 'Impersonation session started successfully').send(res);
});

export const stopImpersonate = asyncHandler(async (req: Request, res: Response) => {
  const sessionId = req.impersonator?.sessionId;
  const impersonatorId = req.impersonator?.userId;
  const targetUserId = req.user?.id;

  const result = await service.stopImpersonation({
    sessionId,
    impersonatorId,
    targetUserId,
  });

  AppResponse.ok(result, 'Impersonation session stopped successfully').send(res);
});
