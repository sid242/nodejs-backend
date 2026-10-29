import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const auditModuleDefinition: DomainModuleDefinition = {
  key: 'audit',
  name: 'Security & Audit Logs',
  description: 'Enterprise security activity logs and compliance history',
  icon: 'file-text',
  sortOrder: 40,
  permissions: [
    {
      key: 'audit:read',
      name: 'View Audit Logs',
      action: 'read',
      description: 'Inspect audit trail and security events',
    },
  ],
};
