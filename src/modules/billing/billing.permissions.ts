import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const billingModuleDefinition: DomainModuleDefinition = {
  key: 'billing',
  name: 'Subscription & Billing',
  description: 'View workspace subscription tier, quotas, resource limits, and invoices',
  icon: 'credit-card',
  sortOrder: 30,
  permissions: [
    {
      key: 'billing:read',
      name: 'View Billing & Limits',
      action: 'read',
      description: 'View current subscription tier, capacity usage, quotas, and invoices',
    },
    {
      key: 'billing:manage',
      name: 'Manage Billing',
      action: 'manage',
      description: 'Submit plan change requests and manage payment methods',
    },
  ],
};
