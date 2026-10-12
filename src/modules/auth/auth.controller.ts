import type { Request, Response } from 'express';
import { asyncHandler } from '@/lib/async-handler.js';
import { AppResponse } from '@/lib/responses.js';
import { AppError } from '@/lib/errors.js';
import { revokeRefreshToken } from '@/modules/auth/tokens.js';
import { setAuthCookies, clearAuthCookies } from '@/modules/auth/cookies.js';
import { REFRESH_TOKEN_COOKIE } from '@/constants/index.js';
import * as service from '@/modules/auth/auth.service.js';

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

export const requestEmailVerification = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestEmailVerification({
    userId: req.user?.id,
    email: req.valid?.body?.email,
  });
  AppResponse.ok(result).send(res);
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.verifyEmail(req.valid?.body);
  AppResponse.ok(result).send(res);
});
