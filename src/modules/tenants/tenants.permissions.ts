import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const tenantsModuleDefinition: DomainModuleDefinition = {
  key: 'tenants',
  name: 'Organization & Workspace',
  description: 'Manage company settings, workspace details, and subscription plan',
  icon: 'building',
  sortOrder: 20,
  permissions: [
    {
      key: 'tenants:read',
      name: 'View Organization',
      action: 'read',
      description: 'View organization details',
    },
    {
      key: 'tenants:update',
      name: 'Update Organization',
      action: 'update',
      description: 'Modify organization info and plan',
    },
    {
      key: 'tenants:delete',
      name: 'Delete Organization',
      action: 'delete',
      description: 'Permanently remove organization',
    },
  ],
};

export const membersModuleDefinition: DomainModuleDefinition = {
  key: 'members',
  name: 'Team & Member Management',
  description: 'Invite colleagues, manage team roster, and update membership status',
  icon: 'users',
  sortOrder: 25,
  permissions: [
    {
      key: 'members:read',
      name: 'View Team Members',
      action: 'read',
      description: 'List workspace members',
    },
    {
      key: 'members:invite',
      name: 'Invite Team Members',
      action: 'invite',
      description: 'Send invitations to new members',
    },
    {
      key: 'members:update',
      name: 'Update Member Status',
      action: 'update',
      description: 'Change membership active/suspended status',
    },
    {
      key: 'members:delete',
      name: 'Remove Member',
      action: 'delete',
      description: 'Remove member from organization',
    },
  ],
};
