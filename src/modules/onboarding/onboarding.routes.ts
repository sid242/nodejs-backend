import { Router } from 'express';

import { requireAuth } from '@/middleware/auth';
import { requirePermission } from '@/middleware/rbac';
import { requireTenant } from '@/middleware/tenant';
import { validate } from '@/middleware/validate';

import * as onboardingController from './onboarding.controller';
import { updateOnboardingStepDto } from './onboarding.dto';
import { ONBOARDING_PERMISSIONS } from './onboarding.permissions';

export const onboardingRouter = Router({ mergeParams: true });

onboardingRouter.use(requireAuth, requireTenant);

onboardingRouter.get(
  '/',
  requirePermission(ONBOARDING_PERMISSIONS.ONBOARDING_READ),
  onboardingController.getOnboardingOverview,
);

onboardingRouter.patch(
  '/steps/:stepKey',
  requirePermission(ONBOARDING_PERMISSIONS.ONBOARDING_UPDATE),
  validate({ body: updateOnboardingStepDto }),
  onboardingController.updateStepProgress,
);

onboardingRouter.post(
  '/steps/:stepKey/skip',
  requirePermission(ONBOARDING_PERMISSIONS.ONBOARDING_UPDATE),
  onboardingController.skipStep,
);
