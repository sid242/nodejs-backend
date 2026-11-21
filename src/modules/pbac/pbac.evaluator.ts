import { Policy } from '@/db/schema/access/policies';

import {
  AttributeCondition,
  EvaluationResult,
  MatchedPolicyTrace,
  PolicyConditionTree,
  PolicyEvaluationContext,
} from './pbac.types';

/**
 * Resolves a dotted path (e.g., 'resource.assignedMemberId', 'actor.memberId')
 * against the evaluation context safely.
 */
export function resolvePath(path: string, context: PolicyEvaluationContext): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)?.[part];
  }

  return current;
}

/**
 * Evaluates whether an expected value contains a dynamic variable reference
 * (e.g. "actor.memberId" or "actor.departmentId") and resolves it, or returns literal.
 */
function resolveDynamicValue(value: unknown, context: PolicyEvaluationContext): unknown {
  if (typeof value === 'string' && (value.startsWith('actor.') || value.startsWith('env.'))) {
    return resolvePath(value, context);
  }
  return value;
}

/**
 * Compares two values for ordered comparisons ($gt, $gte, $lt, $lte).
 * Supports numbers, Dates, ISO date strings, and standard strings.
 * Returns -1 if a < b, 1 if a > b, 0 if a === b, or null if uncomparable.
 */
function compareValues(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  if (a instanceof Date || b instanceof Date) {
    const actTime = a instanceof Date ? a.getTime() : new Date(a as string | number).getTime();
    const tgtTime = b instanceof Date ? b.getTime() : new Date(b as string | number).getTime();
    if (isNaN(actTime) || isNaN(tgtTime)) return null;
    return actTime < tgtTime ? -1 : actTime > tgtTime ? 1 : 0;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    // Check if both are valid ISO date strings
    const actDate = Date.parse(a);
    const tgtDate = Date.parse(b);
    if (!isNaN(actDate) && !isNaN(tgtDate) && a.includes('-') && b.includes('-')) {
      return actDate < tgtDate ? -1 : actDate > tgtDate ? 1 : 0;
    }
    return a.localeCompare(b);
  }

  return null;
}

/**
 * Evaluates a single attribute condition against the evaluation context.
 */
export function evaluateAttributeCondition(
  cond: AttributeCondition,
  context: PolicyEvaluationContext,
): boolean {
  const actualRaw = resolvePath(cond?.attribute, context);
  const targetRaw = resolveDynamicValue(cond?.value, context);

  switch (cond?.operator) {
    case '$eq': {
      if (targetRaw === null || targetRaw === undefined) {
        return actualRaw === null || actualRaw === undefined;
      }
      return actualRaw === targetRaw;
    }

    case '$ne': {
      if (targetRaw === null || targetRaw === undefined) {
        return actualRaw !== null && actualRaw !== undefined;
      }
      return actualRaw !== targetRaw;
    }

    case '$in': {
      if (!Array.isArray(targetRaw)) return false;
      return targetRaw.some((item) => {
        if (item === null || item === undefined) {
          return actualRaw === null || actualRaw === undefined;
        }
        return item === actualRaw;
      });
    }

    case '$nin': {
      if (!Array.isArray(targetRaw)) return true;
      return !targetRaw.some((item) => {
        if (item === null || item === undefined) {
          return actualRaw === null || actualRaw === undefined;
        }
        return item === actualRaw;
      });
    }

    case '$gt': {
      const cmp = compareValues(actualRaw, targetRaw);
      return cmp !== null && cmp > 0;
    }

    case '$gte': {
      const cmp = compareValues(actualRaw, targetRaw);
      return cmp !== null && cmp >= 0;
    }

    case '$lt': {
      const cmp = compareValues(actualRaw, targetRaw);
      return cmp !== null && cmp < 0;
    }

    case '$lte': {
      const cmp = compareValues(actualRaw, targetRaw);
      return cmp !== null && cmp <= 0;
    }

    case '$contains': {
      if (typeof actualRaw === 'string' && typeof targetRaw === 'string') {
        return actualRaw.toLowerCase().includes(targetRaw.toLowerCase());
      }
      if (Array.isArray(actualRaw)) {
        return actualRaw.includes(targetRaw as never);
      }
      return false;
    }

    case '$startsWith': {
      if (typeof actualRaw === 'string' && typeof targetRaw === 'string') {
        return actualRaw.startsWith(targetRaw);
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Recursively evaluates a condition rule tree.
 * Enforces fail-closed: an object without recognized condition keys returns false.
 * Only explicit `{ always: true }` returns true unconditionally.
 */
export function evaluateConditionTree(
  tree: PolicyConditionTree | { always?: boolean },
  context: PolicyEvaluationContext,
): boolean {
  if (!tree || typeof tree !== 'object') return false;

  // Explicit unconditional allow
  if ('always' in tree && tree.always === true) {
    return true;
  }

  // Single attribute condition leaf
  if ('attribute' in tree && 'operator' in tree) {
    return evaluateAttributeCondition(tree as AttributeCondition, context);
  }

  const rule = tree as {
    all?: (PolicyConditionTree | { always?: boolean })[];
    any?: (PolicyConditionTree | { always?: boolean })[];
    none?: (PolicyConditionTree | { always?: boolean })[];
  };

  const hasAll = Array.isArray(rule.all);
  const hasAny = Array.isArray(rule.any);
  const hasNone = Array.isArray(rule.none);

  // If object has neither attribute condition nor all/any/none clauses, fail closed
  if (!hasAll && !hasAny && !hasNone) {
    return false;
  }

  // 'all' clause: every condition must match (empty list evaluates to false)
  if (hasAll) {
    if (rule.all!.length === 0) return false;
    const allPassed = rule.all!.every((child) => evaluateConditionTree(child, context));
    if (!allPassed) return false;
  }

  // 'any' clause: at least one condition must match (empty list evaluates to false)
  if (hasAny) {
    if (rule.any!.length === 0) return false;
    const anyPassed = rule.any!.some((child) => evaluateConditionTree(child, context));
    if (!anyPassed) return false;
  }

  // 'none' clause: no condition may match (empty list evaluates to false)
  if (hasNone) {
    if (rule.none!.length === 0) return false;
    const nonePassed = rule.none!.every((child) => !evaluateConditionTree(child, context));
    if (!nonePassed) return false;
  }

  return true;
}

/**
 * Evaluates a list of policies for an actor and target resource.
 * Adheres to strict priority and security invariants:
 * 1. Evaluates tier by tier, grouped by priority descending (highest priority wins).
 * 2. Within a priority tier, explicit deny trumps allow.
 * 3. An allow in a higher priority tier overrides any policy in lower priority tiers.
 * 4. If no policies match or policies list is empty: DEFAULT DENY.
 */
export function evaluatePolicies(
  policies: Policy[],
  context: PolicyEvaluationContext,
): EvaluationResult {
  const traces: MatchedPolicyTrace[] = [];

  // Group policies by priority descending
  const priorityMap = new Map<number, Policy[]>();
  for (const policy of policies ?? []) {
    if (!policy?.isActive) continue;
    const prio = policy.priority ?? 0;
    const list = priorityMap.get(prio) ?? [];
    list.push(policy);
    priorityMap.set(prio, list);
  }

  const sortedPriorities = Array.from(priorityMap.keys()).sort((a, b) => b - a);

  for (const prio of sortedPriorities) {
    const tierPolicies = priorityMap.get(prio)!;
    let tierHasDeny = false;
    let tierHasAllow = false;

    for (const policy of tierPolicies) {
      const matched = evaluateConditionTree(policy.conditions as PolicyConditionTree, context);

      traces.push({
        policyId: policy.id,
        policyName: policy.name,
        effect: policy.effect,
        priority: prio,
        matched,
        reason: matched ? 'Condition satisfied' : 'Condition not satisfied',
      });

      if (matched) {
        if (policy.effect === 'deny') {
          tierHasDeny = true;
        } else if (policy.effect === 'allow') {
          tierHasAllow = true;
        }
      }
    }

    // Within this priority tier, deny overrides allow
    if (tierHasDeny) {
      return {
        allowed: false,
        effect: 'deny',
        traces,
      };
    }

    // If an allow matched in this tier and no deny in this tier, allow wins!
    if (tierHasAllow) {
      return {
        allowed: true,
        effect: 'allow',
        traces,
      };
    }

    // Neither allow nor deny matched in this tier, continue down to next tier
  }

  // Default deny if no policies matched
  return {
    allowed: false,
    effect: 'default_deny',
    traces,
  };
}
