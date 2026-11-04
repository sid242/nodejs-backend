export interface ModulePermissionDefinition {
  key: string;
  code?: string;
  name: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'manage' | 'invite' | 'assign' | string;
  description?: string;
  resource?: string;
  scope?: 'TENANT' | 'PLATFORM';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  isSystem?: boolean;
  isAssignable?: boolean;
}

export interface DomainModuleDefinition {
  key: string;
  name: string;
  description: string;
  icon?: string;
  sortOrder?: number;
  permissions: ModulePermissionDefinition[];
}
