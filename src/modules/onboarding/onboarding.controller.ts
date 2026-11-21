import type { Request, Response } from 'express';

import { asyncHandler } from '@/lib/async-handler';
import { AppResponse } from '@/lib/responses';

import type { UpdateOnboardingStepDto } from './onboarding.dto';
import * as onboardingService from './onboarding.service';

export const getOnboardingOverview = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const overview = await onboardingService.getOnboardingOverview(tenantId);
  res.json(AppResponse.ok(overview, 'Onboarding overview retrieved'));
});

export const updateStepProgress = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const stepKey = String(req.params.stepKey);
  const body = req.body as UpdateOnboardingStepDto;
  const userId = req.user?.id;

  const result = await onboardingService.updateStepProgress(tenantId, stepKey, body, userId);
  res.json(AppResponse.ok(result, 'Step progress updated'));
});

export const skipStep = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const stepKey = String(req.params.stepKey);
  const userId = req.user?.id;

  const result = await onboardingService.skipStep(tenantId, stepKey, userId);
  res.json(AppResponse.ok(result, 'Step skipped'));
});
