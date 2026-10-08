import { asyncHandler } from '../../lib/async-handler.js';
import { AppResponse } from '../../lib/responses.js';
import * as service from './users.service.js';

export const getMe = asyncHandler(async (req, res) => {
  const user = await service.getMe(req.user.id);
  AppResponse.ok(user).send(res);
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await service.updateMe(req.user.id, req.valid.body);
  AppResponse.ok(user, 'Profile updated').send(res);
});

export const listUsers = asyncHandler(async (req, res) => {
  const data = await service.listUsers(req.valid.query);
  AppResponse.ok(data).send(res);
});
