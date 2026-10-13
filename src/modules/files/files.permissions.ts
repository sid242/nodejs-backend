import type { DomainModuleDefinition } from '@/modules/rbac/modules.types.js';

export const filesModuleDefinition: DomainModuleDefinition = {
  key: 'files',
  name: 'File Storage & Media',
  description: 'S3 direct presigned uploads, media asset storage, and download links',
  icon: 'folder',
  sortOrder: 10,
  permissions: [
    {
      key: 'files:read',
      name: 'View & Download Files',
      action: 'read',
      description: 'Access organization files',
    },
    {
      key: 'files:write',
      name: 'Upload & Create Files',
      action: 'create',
      description: 'Upload new files to S3',
    },
    {
      key: 'files:delete',
      name: 'Delete Files',
      action: 'delete',
      description: 'Delete organization files',
    },
  ],
};
