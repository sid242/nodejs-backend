import type { DomainModuleDefinition } from './modules.types.js';

export const platformModuleDefinition: DomainModuleDefinition = {
  key: 'platform',
  name: 'Platform Operations & Staff Delegation',
  description: 'Enterprise controls for platform staff, tenant oversight, and billing operations',
  icon: 'crown',
  sortOrder: 5,
  permissions: [
    {
      key: 'platform:tenants:read',
      name: 'View All Tenants',
      action: 'read',
      description: 'Inspect any company workspace across the platform',
    },
    {
      key: 'platform:tenants:manage',
      name: 'Manage Tenants',
      action: 'manage',
      description: 'Create, suspend, activate, or modify tenant workspaces',
    },
    {
      key: 'platform:users:impersonate',
      name: 'Impersonate Tenant User',
      action: 'impersonate',
      description: 'Log into any tenant session to troubleshoot support tickets',
    },
    {
      key: 'platform:billing:manage',
      name: 'Billing & Plans Management',
      action: 'manage',
      description: 'Manage tenant subscription tiers, invoices, and payment statuses',
    },
    {
      key: 'platform:staff:manage',
      name: 'Manage Platform Staff & Roles',
      action: 'manage',
      description: 'Create platform roles, invite staff, and assign platform roles',
    },
    {
      key: 'platform:audit:read',
      name: 'View Global Audit Logs',
      action: 'read',
      description: 'Inspect global compliance and platform security logs',
    },
  ],
};
