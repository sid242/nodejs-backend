import type { PlanLimits } from '@/db/schema/index';

export interface DefaultPlanDefinition {
  key: string;
  name: string;
  description: string;
  priceMonthlyMinor: number;
  priceYearlyMinor: number;
  currency: string;
  trialDays: number;
  limits: PlanLimits;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
}

export const DEFAULT_PLANS: DefaultPlanDefinition[] = [
  {
    key: 'FREE',
    name: 'Free Starter',
    description: 'Essential collaboration tools for small teams getting started.',
    priceMonthlyMinor: 0,
    priceYearlyMinor: 0,
    currency: 'INR',
    trialDays: 14,
    limits: {
      maxMembers: 5,
      maxStorageBytes: 1 * 1024 * 1024 * 1024, // 1 GiB
      maxCustomRoles: 2,
      urlAccess: {
        path: true,
        subdomain: false,
        customDomain: false,
      },
    },
    isPublic: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    key: 'PRO',
    name: 'Professional Team',
    description: 'Advanced workspace governance, elevated limits, and extended collaboration.',
    priceMonthlyMinor: 299900, // ₹2,999 / mo
    priceYearlyMinor: 2999000, // ₹29,990 / yr
    currency: 'INR',
    trialDays: 14,
    limits: {
      maxMembers: 25,
      maxStorageBytes: 50 * 1024 * 1024 * 1024, // 50 GiB
      maxCustomRoles: 20,
      urlAccess: {
        path: true,
        subdomain: true,
        customDomain: false,
      },
    },
    isPublic: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    key: 'ENTERPRISE',
    name: 'Enterprise Scale',
    description: 'Unlimited capacity, bespoke tenancy SLA, and dedicated compliance.',
    priceMonthlyMinor: 999900, // ₹9,999 / mo
    priceYearlyMinor: 9999000, // ₹99,990 / yr
    currency: 'INR',
    trialDays: 30,
    limits: {
      maxMembers: null, // unlimited
      maxStorageBytes: null, // unlimited
      maxCustomRoles: null, // unlimited
      urlAccess: {
        path: true,
        subdomain: true,
        customDomain: true,
      },
    },
    isPublic: true,
    isActive: true,
    sortOrder: 3,
  },
];

export const DEFAULT_PLAN_KEY = 'FREE';
export const DEFAULT_TRIAL_DAYS = 14;
