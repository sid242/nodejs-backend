import { env } from '@/config/env';
import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

const leadsCatalog = {
  key: 'leads',
  name: 'CRM Leads',
  description: 'Manage prospective deals under workspace policies',
  icon: 'circle',
  permissions: [],
} satisfies DomainModuleDefinition;

export const optionalModules = {
  leads: {
    catalog: leadsCatalog,
    mountPath: '/leads',
    searchPage: {
      id: 'page-leads',
      title: 'CRM Leads',
      subtitle: 'Manage prospective deals',
      category: 'Pages',
      href: '/leads',
    },
    entitlement: 'modules.leads',
    rolloutFlag: 'module.leads.available',
  },
} as const;

export type OptionalModuleKey = keyof typeof optionalModules;
export const optionalModuleKeys = Object.keys(optionalModules) as OptionalModuleKey[];

const installedModules = new Set(env.FOUNDATION_MODULES.split(',').map((key) => key.trim()));
for (const key of installedModules) {
  if (key && !Object.hasOwn(optionalModules, key)) {
    throw new Error('Unknown optional business module: ' + key);
  }
}

export function isModuleInstalled(key: OptionalModuleKey): boolean {
  return installedModules.has(key);
}
