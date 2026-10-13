export interface ModulePermissionDefinition {
  key: string;
  name: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'manage' | 'invite' | 'assign' | string;
  description?: string;
}

export interface DomainModuleDefinition {
  key: string;
  name: string;
  description: string;
  icon?: string;
  sortOrder?: number;
  permissions: ModulePermissionDefinition[];
}
