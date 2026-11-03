import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const groupsModuleDefinition: DomainModuleDefinition = {
  key: 'groups',
  name: 'User Groups',
  description: 'Organize workspace members into functional groups, departments, and teams',
  icon: 'users',
  sortOrder: 28,
  permissions: [
    {
      key: 'groups:read',
      name: 'View User Groups',
      action: 'read',
      description: 'List workspace groups and view group member rosters',
    },
    {
      key: 'groups:create',
      name: 'Create User Group',
      action: 'create',
      description: 'Create new user groups within the workspace',
    },
    {
      key: 'groups:update',
      name: 'Update User Group',
      action: 'update',
      description: 'Modify user group names, descriptions, and settings',
    },
    {
      key: 'groups:delete',
      name: 'Delete / Archive User Group',
      action: 'delete',
      description: 'Archive or remove user groups from the workspace',
    },
    {
      key: 'groups:manage-members',
      name: 'Manage Group Members',
      action: 'manage',
      description: 'Add or remove workspace members from user groups',
    },
  ],
};

