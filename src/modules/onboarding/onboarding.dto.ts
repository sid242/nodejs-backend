import { z } from 'zod';

export const ONBOARDING_STEP_KEYS = [
  'verify_email',
  'setup_branding',
  'invite_members',
  'create_role',
  'upload_file',
  'configure_smtp',
  'enable_2fa',
  'configure_sso',
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export const updateOnboardingStepDto = z.object({
  status: z.enum(['COMPLETED', 'SKIPPED']),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateOnboardingStepDto = z.infer<typeof updateOnboardingStepDto>;
