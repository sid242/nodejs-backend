import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const auditModuleDefinition: DomainModuleDefinition = {
  key: 'audit',
  name: 'Security & Audit Logs',
  description: 'Enterprise security activity logs, compliance history, and retention policies',
  icon: 'file-text',
  sortOrder: 40,
  permissions: [
    {
      key: 'audit:read',
      name: 'View Audit Logs',
      action: 'read',
      description: 'Inspect audit trail and security events',
    },
    {
      key: 'audit:export',
      name: 'Export Audit Logs',
      action: 'export',
      description: 'Export audit trails to CSV or JSON for compliance and archival',
    },
    {
      key: 'audit:retention:manage',
      name: 'Manage Retention Policy',
      action: 'manage',
      description: 'Configure audit log retention window and compliance frameworks',
    },
  ],
};
