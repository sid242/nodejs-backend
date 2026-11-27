import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as groupsService from './groups.service';

export const createPlatformGroup = asyncHandler(async (req: Request, res: Response) => {
  const result = await groupsService.createPlatformGroup(req.staff!.id, req.valid!.body);
  AppResponse.created(result, 'Platform group created successfully').send(res);
});

export const listPlatformGroups = asyncHandler(async (req: Request, res: Response) => {
  const result = await groupsService.listPlatformGroups(req.valid!.query);
  AppResponse.ok(result, 'Platform groups retrieved successfully').send(res);
});

export const getPlatformGroup = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.getPlatformGroup(groupId);
  AppResponse.ok(result, 'Platform group retrieved successfully').send(res);
});

export const updatePlatformGroup = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.updatePlatformGroup(groupId, req.staff!.id, req.valid!.body);
  AppResponse.ok(result, 'Platform group updated successfully').send(res);
});

export const archivePlatformGroup = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.archivePlatformGroup(groupId, req.staff!.id);
  AppResponse.ok(result, 'Platform group archived successfully').send(res);
});

export const listPlatformGroupMembers = asyncHandler(async (req: Request, res: Response) => {
  const { groupId } = req.valid!.params;
  const { page, limit } = req.valid!.query;

  const result = await groupsService.listPlatformGroupMembers(groupId, page, limit);
  AppResponse.ok(result, 'Platform group members retrieved successfully').send(res);
});

export const addPlatformGroupMembers = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.addPlatformGroupMembers(
    groupId,
    req.staff!.id,
    req.valid!.body,
  );
  AppResponse.ok(result, 'Staff members added to platform group successfully').send(res);
});

export const removePlatformGroupMember = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const staffId = (req.params.staffId ?? req.valid?.params?.staffId) as string;
  await groupsService.removePlatformGroupMember(groupId, req.staff!.id, staffId);
  AppResponse.ok({ success: true }, 'Staff member removed from platform group successfully').send(
    res,
  );
});

export const listPlatformGroupRoles = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.listPlatformGroupRoles(groupId);
  AppResponse.ok(result, 'Platform group roles retrieved successfully').send(res);
});

export const bindPlatformGroupRole = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.bindPlatformGroupRole(groupId, req.staff!.id, req.valid!.body);
  AppResponse.ok(result, 'Role bound to platform group successfully').send(res);
});

export const unbindPlatformGroupRole = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const roleId = (req.params.roleId ?? req.valid?.params?.roleId) as string;
  await groupsService.unbindPlatformGroupRole(groupId, req.staff!.id, roleId);
  AppResponse.ok({ success: true }, 'Role unbound from platform group successfully').send(res);
});

export const getPlatformGroupPermissions = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.getPlatformGroupPermissions(groupId);
  AppResponse.ok(result, 'Platform group permissions retrieved successfully').send(res);
});

export const listPlatformGroupPolicies = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.listPlatformGroupPolicies(groupId);
  AppResponse.ok(result, 'Platform group policies retrieved successfully').send(res);
});

export const bindPlatformGroupPolicy = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const result = await groupsService.bindPlatformGroupPolicy(
    groupId,
    req.staff!.id,
    req.valid!.body,
  );
  AppResponse.ok(result, 'Policy bound to platform group successfully').send(res);
});

export const unbindPlatformGroupPolicy = asyncHandler(async (req: Request, res: Response) => {
  const groupId = (req.params.groupId ?? req.valid?.params?.groupId) as string;
  const policyId = (req.params.policyId ?? req.valid?.params?.policyId) as string;
  await groupsService.unbindPlatformGroupPolicy(groupId, req.staff!.id, policyId);
  AppResponse.ok({ success: true }, 'Policy unbound from platform group successfully').send(res);
});
