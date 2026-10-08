import { asyncHandler } from '../../lib/async-handler.js';
import { AppResponse } from '../../lib/responses.js';
import { revokeRefreshToken } from './tokens.js';
import * as service from './auth.service.js';

export const register = asyncHandler(async (req, res) => {
  const result = await service.register(req.valid.body);
  AppResponse.created(result, 'Registered').send(res);
});

export const login = asyncHandler(async (req, res) => {
  const result = await service.login(req.valid.body);
  AppResponse.ok(result, 'Logged in').send(res);
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await service.refresh(req.valid.body.refreshToken);
  AppResponse.ok(result, 'Token refreshed').send(res);
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.valid.body.refreshToken);
  res.status(204).end();
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await service.forgotPassword(req.valid.body);
  AppResponse.ok(result).send(res);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await service.resetPassword(req.valid.body);
  AppResponse.ok(result).send(res);
});

export const requestEmailVerification = asyncHandler(async (req, res) => {
  const result = await service.requestEmailVerification(req.user.id);
  AppResponse.ok(result).send(res);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await service.verifyEmail(req.valid.body);
  AppResponse.ok(result).send(res);
});
