import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as groupsService from './groups.service';

export const createGroup = asyncHandler(async (req: Request, res: Response) => {
  const result = await groupsService.createTenantGroup(
    req.tenant!.id,
    req.user!.id,
    req.valid!.body,
  );
  AppResponse.created(result, 'User group created successfully').send(res);
});

export const listGroups = asyncHandler(async (req: Request, res: Response) => {
  const result = await groupsService.listTenantGroups(req.tenant!.id, req.valid!.query);
  AppResponse.ok(result, 'User groups retrieved successfully').send(res);
});

export const getGroup = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.getTenantGroup(req.tenant!.id, groupId);
  AppResponse.ok(result, 'User group retrieved successfully').send(res);
});

export const updateGroup = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.updateTenantGroup(
    req.tenant!.id,
    groupId,
    req.user!.id,
    req.valid!.body,
  );
  AppResponse.ok(result, 'User group updated successfully').send(res);
});

export const archiveGroup = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.archiveTenantGroup(
    req.tenant!.id,
    groupId,
    req.user!.id,
  );
  AppResponse.ok(result, 'User group archived successfully').send(res);
});

export const listGroupMembers = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  const result = await groupsService.listTenantGroupMembers(
    req.tenant!.id,
    groupId,
    page,
    limit,
  );
  AppResponse.ok(result, 'Group members retrieved successfully').send(res);
});

export const addGroupMembers = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.addTenantGroupMembers(
    req.tenant!.id,
    groupId,
    req.user!.id,
    req.valid!.body,
  );
  AppResponse.ok(result, 'Members added to user group successfully').send(res);
});

export const removeGroupMember = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const userId = (req.params.userId ?? req.valid?.params?.userId) as string;
  await groupsService.removeTenantGroupMember(
    req.tenant!.id,
    groupId,
    req.user!.id,
    userId,
  );
  AppResponse.ok({ success: true }, 'Member removed from user group successfully').send(res);
});
