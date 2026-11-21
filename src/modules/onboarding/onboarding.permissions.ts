import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const ONBOARDING_PERMISSIONS = {
  ONBOARDING_READ: 'onboarding:read',
  ONBOARDING_UPDATE: 'onboarding:update',
  SUPPORT_READ: 'support:read',
  SUPPORT_CREATE: 'support:create',
  SUPPORT_REPLY: 'support:reply',
  FEEDBACK_CREATE: 'feedback:create',
} as const;

export const onboardingModuleDefinition: DomainModuleDefinition = {
  key: 'onboarding',
  name: 'Onboarding & Activation',
  description: 'Track and complete workspace onboarding and activation steps',
  permissions: [
    {
      key: 'onboarding:read',
      name: 'View Onboarding Checklist',
      action: 'read',
      description: 'View onboarding progress and activation checklist status',
    },
    {
      key: 'onboarding:update',
      name: 'Update Onboarding Steps',
      action: 'update',
      description: 'Mark steps as completed or skipped',
    },
  ],
};

export const supportModuleDefinition: DomainModuleDefinition = {
  key: 'support',
  name: 'Support & Help Desk',
  description: 'Manage workspace customer support tickets and user feedback',
  permissions: [
    {
      key: 'support:read',
      name: 'View Support Tickets',
      action: 'read',
      description: 'View organization support ticket history',
    },
    {
      key: 'support:create',
      name: 'Create Support Tickets',
      action: 'create',
      description: 'Submit new support tickets and diagnostic details',
    },
    {
      key: 'support:reply',
      name: 'Reply to Support Tickets',
      action: 'reply',
      description: 'Send messages and responses on open support tickets',
    },
  ],
};
