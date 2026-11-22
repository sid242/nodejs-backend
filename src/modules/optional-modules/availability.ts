import type { RequestHandler } from 'express';

import { AppError } from '@/lib/errors';
import { getTenantEntitlements } from '@/modules/billing/billing.service';
import { findFeatureFlagByKey } from '@/modules/feature-flags/feature-flags.repository';
import { evaluate } from '@/modules/feature-flags/feature-flags.service';
import { findDisabledTenantModules } from '@/modules/rbac/rbac.repository';

import {
  isModuleInstalled,
  optionalModuleKeys,
  optionalModules,
  type OptionalModuleKey,
} from './registry';

export async function isModuleAvailable(
  key: OptionalModuleKey,
  tenantId: string,
): Promise<boolean> {
  if (!isModuleInstalled(key)) return false;

  const module = optionalModules[key];
  const [billing, disabled, rollout] = await Promise.all([
    getTenantEntitlements(tenantId),
    findDisabledTenantModules(tenantId),
    findFeatureFlagByKey(module.rolloutFlag),
  ]);
  const entitled = billing.entitlements[module.entitlement]?.value ?? true;
  if (entitled !== true || disabled.some((entry) => entry.key === key)) return false;

  if (!rollout) return true;
  return (await evaluate(module.rolloutFlag, { tenantId, plan: billing.planKey })) === true;
}

export async function getModuleAvailability(tenantId: string) {
  const entries = await Promise.all(
    optionalModuleKeys.map(async (key) => [key, await isModuleAvailable(key, tenantId)] as const),
  );
  return Object.fromEntries(entries) as Record<OptionalModuleKey, boolean>;
}

export function requireModule(key: OptionalModuleKey): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.tenant || !(await isModuleAvailable(key, req.tenant.id))) {
        return next(AppError.notFound('Module unavailable'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
