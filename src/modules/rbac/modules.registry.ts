import { auditModuleDefinition } from '@/modules/audit/audit.permissions.js';
import { filesModuleDefinition } from '@/modules/files/files.permissions.js';
import { rbacModuleDefinition } from '@/modules/rbac/rbac.permissions.js';
import {
  membersModuleDefinition,
  tenantsModuleDefinition,
} from '@/modules/tenants/tenants.permissions.js';

import type { DomainModuleDefinition } from './modules.types.js';

export const SYSTEM_MODULE_DEFINITIONS: DomainModuleDefinition[] = [
  filesModuleDefinition,
  tenantsModuleDefinition,
  membersModuleDefinition,
  rbacModuleDefinition,
  auditModuleDefinition,
];
