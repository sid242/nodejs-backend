import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const addressesModuleDefinition: DomainModuleDefinition = {
  key: 'addresses',
  name: 'Addresses & Locations',
  description: 'Workspace and member addresses with India administrative-location validation',
  icon: 'map-pin',
  sortOrder: 60,
  permissions: [
    {
      key: 'addresses:read',
      name: 'View Addresses',
      action: 'read',
      description: 'View workspace addresses',
    },
    {
      key: 'addresses:write',
      name: 'Manage Addresses',
      action: 'create',
      description: 'Create and edit workspace addresses',
    },
    {
      key: 'addresses:delete',
      name: 'Delete Addresses',
      action: 'delete',
      description: 'Delete workspace addresses',
    },
  ],
};

