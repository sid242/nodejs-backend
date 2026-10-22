import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler.js';
import { AppResponse } from '@/lib/responses.js';

import * as service from './plans.service.js';

export const listPublicPlans = asyncHandler(async (_req: Request, res: Response) => {
  const result = await service.listPublicPlans();
  AppResponse.ok(result, 'Public plans retrieved successfully').send(res);
});

export const listPlatformPlans = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listAllPlans(req.valid?.query);
  AppResponse.ok(result, 'Platform plans retrieved successfully').send(res);
});

export const getPlanById = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getPlanById(req.valid?.params?.id);
  AppResponse.ok(result, 'Plan retrieved successfully').send(res);
});

export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.createPlan(
    req.staff!.id,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.created(result, 'Plan created successfully').send(res);
});

export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updatePlan(
    req.staff!.id,
    req.valid?.params?.id,
    req.valid?.body,
    req.id ? String(req.id) : undefined,
  );
  AppResponse.ok(result, 'Plan updated successfully').send(res);
});

export const getTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getTenantSubscription(req.tenant!.id);
  AppResponse.ok(result, 'Tenant subscription retrieved successfully').send(res);
});

export const changeTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.changeTenantSubscription(
    req.tenant!.id,
    req.valid?.body,
    req.user?.id,
  );
  AppResponse.ok(result, 'Subscription changed successfully').send(res);
});
