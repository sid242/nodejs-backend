import type { Request, Response } from 'express';
import { asyncHandler } from '@/lib/async-handler.js';
import { AppResponse } from '@/lib/responses.js';
import * as service from '@/modules/users/users.service.js';

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.getMe(req.user!.id);
  AppResponse.ok(user).send(res);
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.updateMe(req.user!.id, req.valid?.body);
  AppResponse.ok(user, 'Profile updated').send(res);
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listUsers(req.valid?.query);
  AppResponse.ok(data).send(res);
});
