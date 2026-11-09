import { SQL } from 'drizzle-orm';

import { PolicyEffect } from '@/db/schema/access/policies';

export type ConditionOperator =
  '$eq' | '$ne' | '$in' | '$nin' | '$gt' | '$gte' | '$lt' | '$lte' | '$contains' | '$startsWith';

export interface AttributeCondition {
  attribute: string; // e.g., 'resource.assignedMemberId', 'resource.departmentId'
  operator: ConditionOperator;
  value: string | number | boolean | Array<string | number> | null;
}

export interface ConditionRule {
  all?: Array<AttributeCondition | ConditionRule>;
  any?: Array<AttributeCondition | ConditionRule>;
  none?: Array<AttributeCondition | ConditionRule>;
}

export type PolicyConditionTree = ConditionRule | AttributeCondition;

export interface ActorContext {
  userId: string;
  memberId?: string;
  roleKeys: string[];
  departmentId?: string | null;
  regionId?: string | null;
  attributes?: Record<string, unknown>;
}

export interface EnvironmentContext {
  currentTime?: Date;
  ip?: string;
}

export interface PolicyEvaluationContext {
  actor: ActorContext;
  resource?: Record<string, unknown>;
  env?: EnvironmentContext;
}

export interface MatchedPolicyTrace {
  policyId: string;
  policyName: string;
  effect: PolicyEffect;
  priority: number;
  matched: boolean;
  reason?: string;
}

export interface EvaluationResult {
  allowed: boolean;
  effect: PolicyEffect | 'default_deny';
  traces: MatchedPolicyTrace[];
}

export interface CompiledScope {
  sqlClause: SQL | undefined;
  hasDenyAll: boolean;
  hasUnconditionalAllow: boolean;
}
