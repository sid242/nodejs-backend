import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';
import * as service from '@/modules/users/users.service';

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.getMe(req.user!.id);
  const support = req.supportSession;
  AppResponse.ok(
    support
      ? {
          ...user,
          support: {
            id: support.id,
            tenantSlug: req.tenant?.slug,
            scope: support.scope,
            expiresAt: support.expiresAt,
          },
        }
      : user,
  ).send(res);
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.updateMe(req.user!.id, req.valid?.body);
  AppResponse.ok(user, 'Profile updated').send(res);
});

export const getLoginHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await service.getLoginHistory(req.user!.id, req.valid?.query);
  AppResponse.ok(history).send(res);
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.listUsers(req.valid?.query);
  AppResponse.ok(data).send(res);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.getUserById(String(req.params.userId));
  AppResponse.ok(user).send(res);
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await service.updateUserStatus(String(req.params.userId), req.valid?.body.status);
  AppResponse.ok(user, 'User status updated successfully').send(res);
});

export const getAvatarUploadUrl = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getAvatarUploadUrl(req.user!.id, req.valid?.body);
  AppResponse.ok(result, 'Avatar upload URL generated').send(res);
});

export const getMemberships = asyncHandler(async (req: Request, res: Response) => {
  const memberships = await service.getMemberships(req.user!.id);
  AppResponse.ok(memberships).send(res);
});

export const requestEmailChange = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.requestEmailChange(req.user!.id, req.valid?.body.newEmail);
  AppResponse.ok(result, result.message).send(res);
});

export const confirmEmailChange = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.confirmEmailChange(req.user!.id, req.valid?.body.token);
  AppResponse.ok(result, result.message).send(res);
});
