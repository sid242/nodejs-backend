import type { DomainModuleDefinition } from '@/modules/rbac/modules.types.js';

export const rbacModuleDefinition: DomainModuleDefinition = {
  key: 'rbac',
  name: 'Access Control & Roles',
  description: 'Manage custom roles, role permissions matrix, and member role assignments',
  icon: 'shield',
  sortOrder: 30,
  permissions: [
    {
      key: 'roles:read',
      name: 'View Roles & Permissions',
      action: 'read',
      description: 'Inspect available roles and permission sets',
    },
    {
      key: 'roles:create',
      name: 'Create Custom Role',
      action: 'create',
      description: 'Create custom roles',
    },
    {
      key: 'roles:update',
      name: 'Update Role Permissions',
      action: 'update',
      description: 'Modify permissions for custom roles',
    },
    {
      key: 'roles:delete',
      name: 'Delete Custom Role',
      action: 'delete',
      description: 'Delete non-system roles',
    },
    {
      key: 'roles:assign',
      name: 'Assign Member Roles',
      action: 'assign',
      description: 'Assign or reassign roles to members',
    },
    {
      key: 'modules:read',
      name: 'View Modules Catalog',
      action: 'read',
      description: 'Inspect system and custom modules',
    },
    {
      key: 'modules:manage',
      name: 'Manage System Modules',
      action: 'manage',
      description: 'Create, update, or remove application modules',
    },
    {
      key: 'permissions:manage',
      name: 'Manage Granular Permissions',
      action: 'manage',
      description: 'Create, update, or remove granular permissions',
    },
  ],
};
