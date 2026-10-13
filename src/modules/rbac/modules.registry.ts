import type { DomainModuleDefinition } from './modules.types.js';
import { filesModuleDefinition } from '@/modules/files/files.permissions.js';
import {
  tenantsModuleDefinition,
  membersModuleDefinition,
} from '@/modules/tenants/tenants.permissions.js';
import { rbacModuleDefinition } from '@/modules/rbac/rbac.permissions.js';
import { auditModuleDefinition } from '@/modules/audit/audit.permissions.js';

export const SYSTEM_MODULE_DEFINITIONS: DomainModuleDefinition[] = [
  filesModuleDefinition,
  tenantsModuleDefinition,
  membersModuleDefinition,
  rbacModuleDefinition,
  auditModuleDefinition,
];
