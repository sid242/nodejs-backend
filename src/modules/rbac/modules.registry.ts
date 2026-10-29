import { auditModuleDefinition } from '@/modules/audit/audit.permissions';
import { billingModuleDefinition } from '@/modules/billing/billing.permissions';
import { filesModuleDefinition } from '@/modules/files/files.permissions';
import { rbacModuleDefinition } from '@/modules/rbac/rbac.permissions';
import {
  membersModuleDefinition,
  tenantsModuleDefinition,
} from '@/modules/tenants/tenants.permissions';

import type { DomainModuleDefinition } from './modules.types';

export const SYSTEM_MODULE_DEFINITIONS: DomainModuleDefinition[] = [
  filesModuleDefinition,
  tenantsModuleDefinition,
  membersModuleDefinition,
  billingModuleDefinition,
  rbacModuleDefinition,
  auditModuleDefinition,
];
