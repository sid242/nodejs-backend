import { logger } from '@/config/logger';

import {
  ONBOARDING_STEP_KEYS,
  type OnboardingStepKey,
  type UpdateOnboardingStepDto,
} from './onboarding.dto';
import * as onboardingRepo from './onboarding.repository';

export interface OnboardingStepItem {
  key: OnboardingStepKey;
  title: string;
  description: string;
  href: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  completedAt?: string | null;
  autoDetected?: boolean;
}

const STEP_DEFINITIONS: Record<
  OnboardingStepKey,
  { title: string; description: string; href: string }
> = {
  verify_email: {
    title: 'Verify your email address',
    description: 'Confirm ownership of your account email address for secure recovery.',
    href: '/settings/profile',
  },
  setup_branding: {
    title: 'Customize workspace branding',
    description: 'Upload your organization logo and choose your brand accent theme.',
    href: '/settings/branding',
  },
  invite_members: {
    title: 'Invite teammates',
    description: 'Add your team members to collaborate inside your shared workspace.',
    href: '/team',
  },
  create_role: {
    title: 'Configure roles & permissions',
    description: 'Define custom access roles or fine-tune permission policies.',
    href: '/roles',
  },
  upload_file: {
    title: 'Upload your first document',
    description: 'Store and manage cloud assets with high-speed presigned S3 uploads.',
    href: '/files',
  },
  configure_smtp: {
    title: 'Configure custom email (SMTP)',
    description: 'Send invitation emails and notifications from your own company domain.',
    href: '/settings/email',
  },
  enable_2fa: {
    title: 'Enable Two-Factor Authentication',
    description: 'Protect workspace access with TOTP authenticator app verification.',
    href: '/settings/security',
  },
  configure_sso: {
    title: 'Set up Single Sign-On (SSO)',
    description: 'Connect enterprise SAML 2.0 or OIDC IdP for single sign-on.',
    href: '/settings/sso',
  },
};

export async function getOnboardingOverview(tenantId: string) {
  const [storedRows, signals] = await Promise.all([
    onboardingRepo.getStoredProgress(tenantId),
    onboardingRepo.checkSystemActivationSignals(tenantId),
  ]);

  const storedMap = new Map(storedRows.map((r) => [r.stepKey, r]));

  const steps: OnboardingStepItem[] = ONBOARDING_STEP_KEYS.map((key) => {
    const def = STEP_DEFINITIONS[key];
    const stored = storedMap.get(key);

    let status: 'PENDING' | 'COMPLETED' | 'SKIPPED' =
      (stored?.status as 'PENDING' | 'COMPLETED' | 'SKIPPED') ?? 'PENDING';
    let autoDetected = false;

    // Check system activation signals for automatic progression
    if (status === 'PENDING') {
      if (key === 'invite_members' && signals.hasInvitedMembers) {
        status = 'COMPLETED';
        autoDetected = true;
      } else if (key === 'setup_branding' && signals.hasBranding) {
        status = 'COMPLETED';
        autoDetected = true;
      } else if (key === 'create_role' && signals.hasCustomRoles) {
        status = 'COMPLETED';
        autoDetected = true;
      } else if (key === 'upload_file' && signals.hasUploadedFiles) {
        status = 'COMPLETED';
        autoDetected = true;
      } else if (key === 'configure_smtp' && signals.hasConfiguredSmtp) {
        status = 'COMPLETED';
        autoDetected = true;
      } else if (key === 'configure_sso' && signals.hasConfiguredSso) {
        status = 'COMPLETED';
        autoDetected = true;
      }
    }

    return {
      key,
      title: def.title,
      description: def.description,
      href: def.href,
      status,
      completedAt: stored?.completedAt ? stored.completedAt.toISOString() : null,
      autoDetected,
    };
  });

  const total = steps.length;
  const completed = steps.filter((s) => s.status === 'COMPLETED').length;
  const skipped = steps.filter((s) => s.status === 'SKIPPED').length;
  const progressPercent = Math.min(100, Math.round(((completed + skipped) / total) * 100));

  return {
    steps,
    totalCount: total,
    completedCount: completed,
    skippedCount: skipped,
    progressPercent,
    isComplete: progressPercent >= 100,
    isDismissed: progressPercent >= 80,
  };
}

export async function updateStepProgress(
  tenantId: string,
  stepKey: string,
  data: UpdateOnboardingStepDto,
  userId?: string,
) {
  logger.info({ tenantId, stepKey, status: data.status }, 'Updating onboarding step progress');
  return onboardingRepo.upsertStepProgress(tenantId, stepKey, data.status, data.data, userId);
}

export async function skipStep(tenantId: string, stepKey: string, userId?: string) {
  return updateStepProgress(tenantId, stepKey, { status: 'SKIPPED' }, userId);
}
