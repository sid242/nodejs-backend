import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './maintenance.service';

export const getGlobalMaintenance = asyncHandler(async (_req: Request, res: Response) => {
  const state = await service.getGlobalMaintenance();
  return AppResponse.ok(state).send(res);
});

export const setGlobalMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const state = await service.setGlobalMaintenance(req.body, req.staff?.id);
  return AppResponse.ok(state, 'Global maintenance mode updated').send(res);
});

export const getTenantMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const state = await service.getTenantMaintenance(String(req.params.tenantId));
  return AppResponse.ok(state).send(res);
});

export const setTenantMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const state = await service.setTenantMaintenance(String(req.params.tenantId), req.body, req.staff?.id);
  return AppResponse.ok(state, 'Tenant maintenance mode updated').send(res);
});
