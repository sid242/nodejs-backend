import { eq } from 'drizzle-orm';

import { tenantDb } from '@/db/tenancy/context';
import {
  tenantSecurityPolicies,
  tenantSettings,
  type NewTenantSecurityPolicyRecord,
  type NewTenantSettingRecord,
  type TenantSecurityPolicyRecord,
  type TenantSettingRecord,
} from '@/db/schema/index';
import type {
  UpdateTenantSecurityPolicyDto,
  UpdateTenantSettingsDto,
} from './tenants.dto';

export async function findSettingsByTenantId(
  tenantId: string,
): Promise<TenantSettingRecord | undefined> {
  const [record] = await tenantDb()
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId));
  return record;
}

export async function upsertSettings(
  tenantId: string,
  data: UpdateTenantSettingsDto,
): Promise<TenantSettingRecord> {
  const payload: Partial<NewTenantSettingRecord> = {
    ...data,
    tenantId,
    updatedAt: new Date(),
  };

  const [record] = await tenantDb()
    .insert(tenantSettings)
    .values({
      tenantId,
      ...data,
    })
    .onConflictDoUpdate({
      target: [tenantSettings.tenantId],
      set: payload,
    })
    .returning();

  return record!;
}

export async function findSecurityPolicyByTenantId(
  tenantId: string,
): Promise<TenantSecurityPolicyRecord | undefined> {
  const [record] = await tenantDb()
    .select()
    .from(tenantSecurityPolicies)
    .where(eq(tenantSecurityPolicies.tenantId, tenantId));
  return record;
}

export async function upsertSecurityPolicy(
  tenantId: string,
  data: UpdateTenantSecurityPolicyDto,
): Promise<TenantSecurityPolicyRecord> {
  const payload: Partial<NewTenantSecurityPolicyRecord> = {
    ...data,
    tenantId,
    updatedAt: new Date(),
  };

  const [record] = await tenantDb()
    .insert(tenantSecurityPolicies)
    .values({
      tenantId,
      ...data,
    })
    .onConflictDoUpdate({
      target: [tenantSecurityPolicies.tenantId],
      set: payload,
    })
    .returning();

  return record!;
}
