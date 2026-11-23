import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const emailTemplatesModuleDefinition: DomainModuleDefinition = {
  key: 'email-templates',
  name: 'Email & Notification Templates',
  description:
    'Transactional email templates, suppression lists, version history, and delivery tracking',
  icon: 'mail',
  sortOrder: 15,
  permissions: [
    {
      key: 'email-templates:read',
      name: 'View & List Email Templates',
      action: 'read',
      description: 'Access organization email templates, delivery logs, and suppression lists',
    },
    {
      key: 'email-templates:write',
      name: 'Create & Edit Email Templates',
      action: 'create',
      description: 'Create, update, rollback, and test send organization email templates',
    },
    {
      key: 'email-templates:delete',
      name: 'Delete Email Templates',
      action: 'delete',
      description: 'Delete organization email templates and suppressions',
    },
  ],
};
