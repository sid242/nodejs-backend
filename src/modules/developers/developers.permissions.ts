import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const DEVELOPERS_PERMISSIONS = {
  API_KEYS_READ: 'api_keys:read',
  API_KEYS_MANAGE: 'api_keys:manage',
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_MANAGE: 'webhooks:manage',
} as const;

export const developersModuleDefinition: DomainModuleDefinition = {
  key: 'developers',
  name: 'Developers & Webhooks',
  description: 'Manage API keys and outbound webhook subscriptions',
  icon: 'code',
  sortOrder: 80,
  permissions: [
    {
      key: DEVELOPERS_PERMISSIONS.API_KEYS_READ,
      name: 'View API Keys',
      action: 'read',
      description: 'View developer API keys and usage statistics',
    },
    {
      key: DEVELOPERS_PERMISSIONS.API_KEYS_MANAGE,
      name: 'Manage API Keys',
      action: 'manage',
      description: 'Create, rotate, and revoke developer API keys',
    },
    {
      key: DEVELOPERS_PERMISSIONS.WEBHOOKS_READ,
      name: 'View Webhooks',
      action: 'read',
      description: 'View webhook endpoints and delivery logs',
    },
    {
      key: DEVELOPERS_PERMISSIONS.WEBHOOKS_MANAGE,
      name: 'Manage Webhooks',
      action: 'manage',
      description: 'Create, edit, test, and delete outbound webhook endpoints',
    },
  ],
};
