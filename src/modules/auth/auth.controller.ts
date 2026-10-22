import type { Request, Response } from 'express';

import { REFRESH_TOKEN_COOKIE } from '@/constants/index.js';
import { asyncHandler } from '@/lib/async-handler.js';
import { AppError } from '@/lib/errors.js';
import { AppResponse } from '@/lib/responses.js';
import * as service from '@/modules/auth/auth.service.js';
import { clearAuthCookies, setAuthCookies } from '@/modules/auth/cookies.js';
import * as sessionsRepo from '@/modules/auth/sessions.repository.js';
import { revokeRefreshToken } from '@/modules/auth/tokens.js';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.register(req.valid?.body);
  setAuthCookies(res, result);
  AppResponse.created(result, 'Registered').send(res);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.login(req.valid?.body);
  setAuthCookies(res, result);
  AppResponse.ok(result, 'Logged in').send(res);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.valid?.body?.refreshToken ?? req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (!token) {
    throw AppError.unauthorized('Refresh token is required');
  }
  const result = await service.refresh(token);
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
  const sessions = await sessionsRepo.findUserActiveSessions(req.user!.id);
  AppResponse.ok(sessions).send(res);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const success = await sessionsRepo.revokeSessionById(String(req.params.sessionId), req.user!.id);
  if (!success) throw AppError.notFound('Session not found');
  AppResponse.ok({ message: 'Session revoked successfully' }).send(res);
});

export const impersonate = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.impersonateUser(req.user!, req.valid?.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    tenantId: req.tenant?.id,
  });
  AppResponse.ok(result, 'Impersonation session started successfully').send(res);
});

export const stopImpersonation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.impersonator) {
    throw AppError.badRequest('Not currently in an active impersonation session');
  }
  const result = await service.stopImpersonation(req.impersonator, req.user!.id, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    tenantId: req.tenant?.id,
  });
  AppResponse.ok(result, 'Impersonation session stopped successfully').send(res);
});

export const requestMagicLink = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestMagicLink(req.valid!.body.email);
  AppResponse.ok(result, result.message).send(res);
});

export const verifyMagicLink = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.verifyMagicLink(req.valid!.body.token);
  AppResponse.ok(result, 'Authenticated successfully via magic link').send(res);
});
