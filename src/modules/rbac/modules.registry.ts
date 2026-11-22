import { addressesModuleDefinition } from '@/modules/addresses/addresses.permissions';
import { analyticsModuleDefinition } from '@/modules/analytics/analytics.permissions';
import { auditModuleDefinition } from '@/modules/audit/audit.permissions';
import { billingModuleDefinition } from '@/modules/billing/billing.permissions';
import { developersModuleDefinition } from '@/modules/developers/developers.permissions';
import { filesModuleDefinition } from '@/modules/files/files.permissions';
import { groupsModuleDefinition } from '@/modules/groups/groups.permissions';
import {
  onboardingModuleDefinition,
  supportModuleDefinition,
} from '@/modules/onboarding/onboarding.permissions';
import { isModuleInstalled, optionalModules } from '@/modules/optional-modules/registry';
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
  groupsModuleDefinition,
  billingModuleDefinition,
  rbacModuleDefinition,
  auditModuleDefinition,
  addressesModuleDefinition,
  developersModuleDefinition,
  analyticsModuleDefinition,
  onboardingModuleDefinition,
  supportModuleDefinition,
  ...(isModuleInstalled('leads') ? [optionalModules.leads.catalog] : []),
];
