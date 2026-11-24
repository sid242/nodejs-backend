import { asc, desc, eq, sql } from 'drizzle-orm';

import {
  featureFlagRules,
  featureFlags,
  type FeatureFlag,
  type FeatureFlagRule,
  type NewFeatureFlag,
  type NewFeatureFlagRule,
} from '@/db/schema';
import { primaryDbHandle } from '@/db/tenancy/context';

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const db = primaryDbHandle();
  return db.select().from(featureFlags).orderBy(desc(featureFlags.createdAt));
}

export async function findFeatureFlagById(id: string): Promise<FeatureFlag | null> {
  const db = primaryDbHandle();
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
  return row ?? null;
}

export async function findFeatureFlagByKey(key: string): Promise<FeatureFlag | null> {
  const db = primaryDbHandle();
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  return row ?? null;
}

export async function createFeatureFlag(data: NewFeatureFlag): Promise<FeatureFlag> {
  const db = primaryDbHandle();
  const [row] = await db.insert(featureFlags).values(data).returning();
  if (!row) throw new Error('Failed to create feature flag');
  return row;
}

export async function updateFeatureFlag(
  id: string,
  data: Partial<NewFeatureFlag>,
): Promise<FeatureFlag | null> {
  const db = primaryDbHandle();
  const [row] = await db
    .update(featureFlags)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(featureFlags.id, id))
    .returning();
  return row ?? null;
}

export async function deleteFeatureFlag(id: string): Promise<boolean> {
  const db = primaryDbHandle();
  const result = await db
    .delete(featureFlags)
    .where(eq(featureFlags.id, id))
    .returning({ id: featureFlags.id });
  return result.length > 0;
}

export async function touchFeatureFlag(id: string): Promise<void> {
  const db = primaryDbHandle();
  await db.update(featureFlags).set({ lastEvaluatedAt: new Date() }).where(eq(featureFlags.id, id));
}

// ─── Rules Repository ────────────────────────────────────────────────────────

export async function listRulesByFlagId(flagId: string): Promise<FeatureFlagRule[]> {
  const db = primaryDbHandle();
  return db
    .select()
    .from(featureFlagRules)
    .where(eq(featureFlagRules.flagId, flagId))
    .orderBy(asc(featureFlagRules.priority));
}

export async function listRulesByFlagKey(flagKey: string): Promise<FeatureFlagRule[]> {
  const db = primaryDbHandle();
  return db
    .select()
    .from(featureFlagRules)
    .where(eq(featureFlagRules.flagKey, flagKey))
    .orderBy(asc(featureFlagRules.priority));
}

export async function createRule(data: NewFeatureFlagRule): Promise<FeatureFlagRule> {
  const db = primaryDbHandle();
  const [row] = await db.insert(featureFlagRules).values(data).returning();
  if (!row) throw new Error('Failed to create feature flag rule');
  return row;
}

export async function updateRule(
  id: string,
  data: Partial<NewFeatureFlagRule>,
): Promise<FeatureFlagRule | null> {
  const db = primaryDbHandle();
  const [row] = await db
    .update(featureFlagRules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(featureFlagRules.id, id))
    .returning();
  return row ?? null;
}

export async function deleteRule(id: string): Promise<boolean> {
  const db = primaryDbHandle();
  const result = await db
    .delete(featureFlagRules)
    .where(eq(featureFlagRules.id, id))
    .returning({ id: featureFlagRules.id });
  return result.length > 0;
}
