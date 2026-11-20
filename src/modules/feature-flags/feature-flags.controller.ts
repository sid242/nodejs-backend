import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import * as service from './feature-flags.service';

export const evaluateFlag = asyncHandler(async (req: Request, res: Response) => {
  const flagKey = String(req.params.key);
  const context = {
    tenantId: req.tenant?.id ?? (req.query.tenantId as string),
    userId: req.user?.id ?? (req.query.userId as string),
    plan: req.query.plan as string,
  };

  const value = await service.evaluate(flagKey, context);
  return AppResponse.ok({ key: flagKey, value }).send(res);
});

export const evaluateAllFlags = asyncHandler(async (req: Request, res: Response) => {
  const context = {
    tenantId: req.tenant?.id ?? (req.query.tenantId as string),
    userId: req.user?.id ?? (req.query.userId as string),
    plan: req.query.plan as string,
  };

  const flags = await service.evaluateAll(context);
  return AppResponse.ok(flags).send(res);
});

// ─── Platform Handlers ───────────────────────────────────────────────────────

export const listFlags = asyncHandler(async (_req: Request, res: Response) => {
  const items = await service.listFlags();
  return AppResponse.ok(items).send(res);
});

export const getFlag = asyncHandler(async (req: Request, res: Response) => {
  const flag = await service.getFlagDetails(String(req.params.id));
  return AppResponse.ok(flag).send(res);
});

export const createFlag = asyncHandler(async (req: Request, res: Response) => {
  const flag = await service.createFlag(req.valid?.body ?? req.body, req.staff?.id);
  return AppResponse.created(flag, 'Feature flag created').send(res);
});

export const updateFlag = asyncHandler(async (req: Request, res: Response) => {
  const updated = await service.updateFlag(String(req.params.id), req.valid?.body ?? req.body, req.staff?.id);
  return AppResponse.ok(updated, 'Feature flag updated').send(res);
});

export const deleteFlag = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.deleteFlag(String(req.params.id), req.staff?.id);
  return AppResponse.ok(result, 'Feature flag deleted').send(res);
});

export const createRule = asyncHandler(async (req: Request, res: Response) => {
  const rule = await service.createRule(String(req.params.id), req.valid?.body ?? req.body);
  return AppResponse.created(rule, 'Targeting rule added').send(res);
});

export const updateRule = asyncHandler(async (req: Request, res: Response) => {
  const rule = await service.updateRule(String(req.params.ruleId), req.valid?.body ?? req.body);
  return AppResponse.ok(rule, 'Targeting rule updated').send(res);
});

export const deleteRule = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.deleteRule(String(req.params.ruleId));
  return AppResponse.ok(result, 'Targeting rule deleted').send(res);
});
