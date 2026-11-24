import crypto from 'node:crypto';

import { env } from '@/config/env';
import { redis } from '@/config/redis';
import type { NewFeatureFlag, NewFeatureFlagRule } from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';

import type {
  CreateFeatureFlagDto,
  CreateFeatureFlagRuleDto,
  EvaluationContextDto,
  UpdateFeatureFlagDto,
  UpdateFeatureFlagRuleDto,
} from './feature-flags.dto';
import * as repo from './feature-flags.repository';

const CACHE_TTL_SECONDS = 30;
const CACHE_PREFIX = 'ff:eval:';

function getStickyPercentage(key: string, seed: string): number {
  const hash = crypto.createHash('md5').update(`${key}:${seed}`).digest();
  return hash.readUInt32BE(0) % 100;
}

export async function evaluate(flagKey: string, context: EvaluationContextDto = {}): Promise<any> {
  const cacheKey = `${CACHE_PREFIX}${flagKey}:${context.tenantId ?? '_'}:${context.userId ?? '_'}:${context.plan ?? '_'}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch {
    // Redis fail-open to primary DB evaluation
  }

  const flag = await repo.findFeatureFlagByKey(flagKey);
  if (!flag) {
    return false;
  }

  // Emergency Kill Switch
  if (flag.killSwitch) {
    return flag.defaultValue;
  }

  // Load priority-ordered rules
  const rules = await repo.listRulesByFlagKey(flagKey);

  let resolvedValue = flag.defaultValue;

  for (const rule of rules) {
    const target = rule.target;
    const criteria = rule.matchCriteria;

    if (target === 'TENANT' && context.tenantId && Array.isArray(criteria)) {
      if (criteria.includes(context.tenantId)) {
        resolvedValue = rule.value;
        break;
      }
    } else if (target === 'PLAN' && context.plan && Array.isArray(criteria)) {
      if (
        criteria.includes(context.plan.toLowerCase()) ||
        criteria.includes(context.plan.toUpperCase())
      ) {
        resolvedValue = rule.value;
        break;
      }
    } else if (target === 'USER' && context.userId && Array.isArray(criteria)) {
      if (criteria.includes(context.userId)) {
        resolvedValue = rule.value;
        break;
      }
    } else if (target === 'ENV' && Array.isArray(criteria)) {
      if (criteria.includes(env.NODE_ENV)) {
        resolvedValue = rule.value;
        break;
      }
    } else if (target === 'PERCENT') {
      const percentage =
        typeof criteria === 'number' ? criteria : ((criteria as any)?.percentage ?? 0);
      const seed = context.tenantId || context.userId || '';
      if (seed && getStickyPercentage(flagKey, seed) < percentage) {
        resolvedValue = rule.value;
        break;
      }
    }
  }

  try {
    await redis.set(cacheKey, JSON.stringify(resolvedValue), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Non-blocking cache error
  }

  // Touch last evaluated asynchronously without awaiting
  repo.touchFeatureFlag(flag.id).catch(() => {});

  return resolvedValue;
}

export async function evaluateAll(
  context: EvaluationContextDto = {},
): Promise<Record<string, any>> {
  const flags = await repo.listFeatureFlags();
  const results: Record<string, any> = {};

  await Promise.all(
    flags.map(async (flag) => {
      results[flag.key] = await evaluate(flag.key, context);
    }),
  );

  return results;
}

// ─── Platform CRUD Services ──────────────────────────────────────────────────

export async function listFlags() {
  return repo.listFeatureFlags();
}

export async function getFlagDetails(id: string) {
  const flag = await repo.findFeatureFlagById(id);
  if (!flag) throw AppError.notFound('Feature flag not found');
  const rules = await repo.listRulesByFlagId(id);
  return { ...flag, rules };
}

export async function createFlag(dto: CreateFeatureFlagDto, staffId?: string) {
  const existing = await repo.findFeatureFlagByKey(dto.key);
  if (existing) {
    throw AppError.conflict(`Feature flag key '${dto.key}' already exists`);
  }

  const flag = await repo.createFeatureFlag({
    key: dto.key,
    name: dto.name,
    description: dto.description ?? null,
    type: dto.type,
    defaultValue: dto.defaultValue,
    ownerStaffId: staffId ?? null,
    tags: dto.tags ?? null,
    killSwitch: false,
  });

  await invalidateFlagCache(dto.key);
  return flag;
}

export async function updateFlag(id: string, dto: UpdateFeatureFlagDto, staffId?: string) {
  const existing = await repo.findFeatureFlagById(id);
  if (!existing) throw AppError.notFound('Feature flag not found');

  const updated = await repo.updateFeatureFlag(id, {
    name: dto.name,
    description: dto.description,
    defaultValue: dto.defaultValue,
    killSwitch: dto.killSwitch,
    tags: dto.tags,
  });

  await invalidateFlagCache(existing.key);
  return updated;
}

export async function deleteFlag(id: string, staffId?: string) {
  const existing = await repo.findFeatureFlagById(id);
  if (!existing) throw AppError.notFound('Feature flag not found');

  await repo.deleteFeatureFlag(id);
  await invalidateFlagCache(existing.key);
  return { success: true };
}

export async function createRule(flagId: string, dto: CreateFeatureFlagRuleDto) {
  const flag = await repo.findFeatureFlagById(flagId);
  if (!flag) throw AppError.notFound('Feature flag not found');

  const rule = await repo.createRule({
    flagId,
    flagKey: flag.key,
    priority: dto.priority,
    target: dto.target,
    matchCriteria: dto.matchCriteria ?? null,
    value: dto.value,
  });

  await invalidateFlagCache(flag.key);
  return rule;
}

export async function updateRule(ruleId: string, dto: UpdateFeatureFlagRuleDto) {
  const updated = await repo.updateRule(ruleId, {
    priority: dto.priority,
    target: dto.target,
    matchCriteria: dto.matchCriteria,
    value: dto.value,
  });
  if (!updated) throw AppError.notFound('Rule not found');

  await invalidateFlagCache(updated.flagKey);
  return updated;
}

export async function deleteRule(ruleId: string) {
  const deleted = await repo.deleteRule(ruleId);
  if (!deleted) throw AppError.notFound('Rule not found');
  await cache.delByPrefix(CACHE_PREFIX);
  return { success: true };
}

async function invalidateFlagCache(flagKey?: string) {
  try {
    if (flagKey) {
      const keys = await redis.keys(`${CACHE_PREFIX}${flagKey}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } else {
      await cache.delByPrefix(CACHE_PREFIX);
    }
  } catch {
    // Non-blocking cache flush error
  }
}
