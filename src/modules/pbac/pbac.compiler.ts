import { and, eq, gt, gte, inArray, lt, lte, ne, not, notInArray, or, SQL, sql } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';

import { Policy } from '@/db/schema/access/policies';

import { resolvePath } from './pbac.evaluator';
import {
  ActorContext,
  AttributeCondition,
  CompiledScope,
  ConditionRule,
  PolicyConditionTree,
  PolicyEvaluationContext,
} from './pbac.types';

/**
 * Maps a resource attribute string (e.g. 'resource.assignedMemberId')
 * to a table column mapping record.
 */
function getColumnForAttribute(
  attributePath: string,
  columns: Record<string, PgColumn>,
): PgColumn | undefined {
  if (!attributePath) return undefined;
  // Strip 'resource.' prefix if present
  const field = attributePath.startsWith('resource.')
    ? attributePath.replace('resource.', '')
    : attributePath;

  return columns?.[field];
}

/**
 * Compiles a single AttributeCondition into a Drizzle SQL condition.
 */
function compileAttributeCondition(
  cond: AttributeCondition,
  columns: Record<string, PgColumn>,
  actorContext: ActorContext,
): SQL | undefined {
  const col = getColumnForAttribute(cond?.attribute, columns);
  if (!col) {
    // If the attribute does not belong to the target table, condition cannot be compiled to SQL directly
    return undefined;
  }

  // Resolve dynamic values like 'actor.memberId'
  let targetVal = cond?.value;
  if (typeof targetVal === 'string' && targetVal.startsWith('actor.')) {
    targetVal = resolvePath(targetVal, { actor: actorContext }) as never;
  }

  switch (cond?.operator) {
    case '$eq':
      return eq(col, targetVal as never);

    case '$ne':
      return ne(col, targetVal as never);

    case '$in':
      if (Array.isArray(targetVal) && targetVal.length > 0) {
        return inArray(col, targetVal as never[]);
      }
      // Empty array in $in means match nothing (false)
      return sql`1 = 0`;

    case '$nin':
      if (Array.isArray(targetVal) && targetVal.length > 0) {
        return notInArray(col, targetVal as never[]);
      }
      return sql`1 = 1`;

    case '$gt':
      return gt(col, targetVal as never);

    case '$gte':
      return gte(col, targetVal as never);

    case '$lt':
      return lt(col, targetVal as never);

    case '$lte':
      return lte(col, targetVal as never);

    default:
      return undefined;
  }
}

/**
 * Recursively compiles a condition tree into Drizzle SQL clauses.
 */
export function compileConditionTreeToSql(
  tree: PolicyConditionTree,
  columns: Record<string, PgColumn>,
  actorContext: ActorContext,
): SQL | undefined {
  if (!tree) return undefined;

  // Single attribute condition
  if ('attribute' in tree && 'operator' in tree) {
    return compileAttributeCondition(tree as AttributeCondition, columns, actorContext);
  }

  const rule = tree as ConditionRule;
  const clauses: SQL[] = [];

  // 'all' clauses (AND)
  if (Array.isArray(rule?.all) && rule.all.length > 0) {
    const subClauses: SQL[] = [];
    for (const child of rule.all) {
      const compiled = compileConditionTreeToSql(child, columns, actorContext);
      if (compiled) subClauses.push(compiled);
    }
    if (subClauses.length > 0) {
      clauses.push(and(...subClauses)!);
    }
  }

  // 'any' clauses (OR)
  if (Array.isArray(rule?.any) && rule.any.length > 0) {
    const subClauses: SQL[] = [];
    for (const child of rule.any) {
      const compiled = compileConditionTreeToSql(child, columns, actorContext);
      if (compiled) subClauses.push(compiled);
    }
    if (subClauses.length > 0) {
      clauses.push(or(...subClauses)!);
    }
  }

  // 'none' clauses (NOT)
  if (Array.isArray(rule?.none) && rule.none.length > 0) {
    for (const child of rule.none) {
      const compiled = compileConditionTreeToSql(child, columns, actorContext);
      if (compiled) clauses.push(not(compiled));
    }
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}

/**
 * Compiles a set of active policies into a combined WHERE clause for list queries.
 * Handles DENY vs ALLOW precedence:
 * - If any active unconditional DENY policy exists, yields deny-all (1 = 0).
 * - Deny policies with conditions add `AND NOT (condition)`.
 * - Allow policies with conditions are joined with `OR`.
 * - If at least one active ALLOW policy has empty conditions, it's unconditional allow.
 */
export function compilePoliciesToSqlScope(
  policies: Policy[],
  columns: Record<string, PgColumn>,
  actorContext: ActorContext,
): CompiledScope {
  const activePolicies = (policies ?? []).filter((p) => p?.isActive);

  if (activePolicies.length === 0) {
    // Default Deny when no policies apply
    return {
      sqlClause: sql`1 = 0`,
      hasDenyAll: true,
      hasUnconditionalAllow: false,
    };
  }

  const allowClauses: SQL[] = [];
  const denyClauses: SQL[] = [];
  let hasUnconditionalAllow = false;

  for (const policy of activePolicies) {
    const isConditionsEmpty =
      !policy.conditions ||
      (typeof policy.conditions === 'object' && Object.keys(policy.conditions).length === 0);

    if (policy.effect === 'deny') {
      if (isConditionsEmpty) {
        // Unconditional DENY trumps everything
        return {
          sqlClause: sql`1 = 0`,
          hasDenyAll: true,
          hasUnconditionalAllow: false,
        };
      }
      const compiled = compileConditionTreeToSql(
        policy.conditions as PolicyConditionTree,
        columns,
        actorContext,
      );
      if (compiled) {
        denyClauses.push(not(compiled));
      }
    } else if (policy.effect === 'allow') {
      if (isConditionsEmpty) {
        hasUnconditionalAllow = true;
      } else {
        const compiled = compileConditionTreeToSql(
          policy.conditions as PolicyConditionTree,
          columns,
          actorContext,
        );
        if (compiled) {
          allowClauses.push(compiled);
        }
      }
    }
  }

  let finalScope: SQL | undefined = undefined;

  if (hasUnconditionalAllow) {
    // Allowed everything, except explicit conditional denies
    if (denyClauses.length > 0) {
      finalScope = and(...denyClauses);
    } else {
      finalScope = undefined; // No extra filter needed
    }
  } else {
    // Only allowed matching allow conditions
    if (allowClauses.length === 0) {
      // No allows matched -> deny all
      return {
        sqlClause: sql`1 = 0`,
        hasDenyAll: true,
        hasUnconditionalAllow: false,
      };
    }

    const mergedAllows = allowClauses.length === 1 ? allowClauses[0] : or(...allowClauses);
    if (denyClauses.length > 0) {
      finalScope = and(mergedAllows, ...denyClauses);
    } else {
      finalScope = mergedAllows;
    }
  }

  return {
    sqlClause: finalScope,
    hasDenyAll: false,
    hasUnconditionalAllow,
  };
}
