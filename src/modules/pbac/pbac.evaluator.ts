import { Policy } from '@/db/schema/access/policies';

import {
  ActorContext,
  AttributeCondition,
  ConditionOperator,
  ConditionRule,
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
 * Evaluates a single attribute condition against the evaluation context.
 */
export function evaluateAttributeCondition(
  cond: AttributeCondition,
  context: PolicyEvaluationContext,
): boolean {
  const actualRaw = resolvePath(cond?.attribute, context);
  const targetRaw = resolveDynamicValue(cond?.value, context);

  switch (cond?.operator) {
    case '$eq':
      return actualRaw === targetRaw;

    case '$ne':
      return actualRaw !== targetRaw;

    case '$in': {
      if (!Array.isArray(targetRaw)) return false;
      return targetRaw.includes(actualRaw as never);
    }

    case '$nin': {
      if (!Array.isArray(targetRaw)) return true;
      return !targetRaw.includes(actualRaw as never);
    }

    case '$gt':
      if (typeof actualRaw === 'number' && typeof targetRaw === 'number') {
        return actualRaw > targetRaw;
      }
      return false;

    case '$gte':
      if (typeof actualRaw === 'number' && typeof targetRaw === 'number') {
        return actualRaw >= targetRaw;
      }
      return false;

    case '$lt':
      if (typeof actualRaw === 'number' && typeof targetRaw === 'number') {
        return actualRaw < targetRaw;
      }
      return false;

    case '$lte':
      if (typeof actualRaw === 'number' && typeof targetRaw === 'number') {
        return actualRaw <= targetRaw;
      }
      return false;

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
 */
export function evaluateConditionTree(
  tree: PolicyConditionTree,
  context: PolicyEvaluationContext,
): boolean {
  if (!tree) return true;

  // Single attribute condition leaf
  if ('attribute' in tree && 'operator' in tree) {
    return evaluateAttributeCondition(tree as AttributeCondition, context);
  }

  const rule = tree as ConditionRule;

  // 'all' clause: every condition must match
  if (Array.isArray(rule?.all) && rule.all.length > 0) {
    const allPassed = rule.all.every((child) => evaluateConditionTree(child, context));
    if (!allPassed) return false;
  }

  // 'any' clause: at least one condition must match
  if (Array.isArray(rule?.any) && rule.any.length > 0) {
    const anyPassed = rule.any.some((child) => evaluateConditionTree(child, context));
    if (!anyPassed) return false;
  }

  // 'none' clause: no condition may match
  if (Array.isArray(rule?.none) && rule.none.length > 0) {
    const nonePassed = rule.none.every((child) => !evaluateConditionTree(child, context));
    if (!nonePassed) return false;
  }

  return true;
}

/**
 * Evaluates a list of policies for an actor and target resource.
 * Adheres to standard security invariants:
 * 1. If any matched policy has effect === 'deny', access is DENIED immediately.
 * 2. If at least one matched policy has effect === 'allow', access is ALLOWED.
 * 3. If no policies match or policies list is empty: DEFAULT DENY.
 */
export function evaluatePolicies(
  policies: Policy[],
  context: PolicyEvaluationContext,
): EvaluationResult {
  const traces: MatchedPolicyTrace[] = [];

  // Sort by priority descending (higher priority evaluated first)
  const sorted = [...(policies ?? [])].sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0));

  let hasExplicitAllow = false;
  let hasExplicitDeny = false;

  for (const policy of sorted) {
    if (!policy?.isActive) {
      continue;
    }

    const matched = evaluateConditionTree(policy.conditions as PolicyConditionTree, context);

    traces.push({
      policyId: policy.id,
      policyName: policy.name,
      effect: policy.effect,
      priority: policy.priority ?? 0,
      matched,
      reason: matched ? `Condition satisfied` : `Condition not satisfied`,
    });

    if (matched) {
      if (policy.effect === 'deny') {
        hasExplicitDeny = true;
        // Explicit deny immediately trumps all allows
        break;
      }
      if (policy.effect === 'allow') {
        hasExplicitAllow = true;
      }
    }
  }

  if (hasExplicitDeny) {
    return {
      allowed: false,
      effect: 'deny',
      traces,
    };
  }

  if (hasExplicitAllow) {
    return {
      allowed: true,
      effect: 'allow',
      traces,
    };
  }

  return {
    allowed: false,
    effect: 'default_deny',
    traces,
  };
}
