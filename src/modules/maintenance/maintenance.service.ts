import { eq } from 'drizzle-orm';

import { redis } from '@/config/redis';
import { primaryDbHandle } from '@/db/tenancy/context';
import { maintenanceConfig, type MaintenanceConfig } from '@/db/schema';
import { AppError } from '@/lib/errors';

export interface MaintenanceState {
  enabled: boolean;
  readOnly: boolean;
  message: string | null;
  startsAt: string | null;
  endsAt: string | null;
  allowStaff: boolean;
}

const REDIS_GLOBAL_KEY = 'maintenance:global';
const REDIS_TENANT_PREFIX = 'maintenance:tenant:';

export async function getGlobalMaintenance(): Promise<MaintenanceState> {
  try {
    const cached = await redis.get(REDIS_GLOBAL_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Fail-open to DB
  }

  const db = primaryDbHandle();
  const [row] = await db
    .select()
    .from(maintenanceConfig)
    .where(eq(maintenanceConfig.scope, 'GLOBAL'))
    .limit(1);

  const state: MaintenanceState = {
    enabled: row?.enabled ?? false,
    readOnly: row?.readOnly ?? false,
    message: row?.message ?? null,
    startsAt: row?.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row?.endsAt ? row.endsAt.toISOString() : null,
    allowStaff: row?.allowStaff ?? true,
  };

  try {
    await redis.set(REDIS_GLOBAL_KEY, JSON.stringify(state), 'EX', 30);
  } catch {
    // Ignore redis error
  }

  return state;
}

export async function getTenantMaintenance(tenantId: string): Promise<MaintenanceState | null> {
  const redisKey = `${REDIS_TENANT_PREFIX}${tenantId}`;
  try {
    const cached = await redis.get(redisKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Fail-open
  }

  const db = primaryDbHandle();
  const [row] = await db
    .select()
    .from(maintenanceConfig)
    .where(eq(maintenanceConfig.tenantId, tenantId))
    .limit(1);

  if (!row) {
    return null;
  }

  const state: MaintenanceState = {
    enabled: row.enabled,
    readOnly: row.readOnly,
    message: row.message ?? null,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    allowStaff: row.allowStaff,
  };

  try {
    await redis.set(redisKey, JSON.stringify(state), 'EX', 30);
  } catch {
    // Ignore redis error
  }

  return state;
}

export async function setGlobalMaintenance(
  dto: {
    enabled: boolean;
    readOnly?: boolean;
    message?: string;
    startsAt?: Date;
    endsAt?: Date;
    allowStaff?: boolean;
  },
  staffId?: string,
): Promise<MaintenanceState> {
  const db = primaryDbHandle();
  const [existing] = await db
    .select()
    .from(maintenanceConfig)
    .where(eq(maintenanceConfig.scope, 'GLOBAL'))
    .limit(1);

  let updated: MaintenanceConfig;
  if (existing) {
    const [row] = await db
      .update(maintenanceConfig)
      .set({
        enabled: dto.enabled,
        readOnly: dto.readOnly ?? false,
        message: dto.message ?? null,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        allowStaff: dto.allowStaff ?? true,
        updatedByStaffId: staffId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(maintenanceConfig.id, existing.id))
      .returning();
    if (!row) throw new Error('Failed to update maintenance config');
    updated = row;
  } else {
    const [row] = await db
      .insert(maintenanceConfig)
      .values({
        scope: 'GLOBAL',
        enabled: dto.enabled,
        readOnly: dto.readOnly ?? false,
        message: dto.message ?? null,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        allowStaff: dto.allowStaff ?? true,
        updatedByStaffId: staffId ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to create maintenance config');
    updated = row;
  }

  const state: MaintenanceState = {
    enabled: updated.enabled,
    readOnly: updated.readOnly,
    message: updated.message ?? null,
    startsAt: updated.startsAt ? updated.startsAt.toISOString() : null,
    endsAt: updated.endsAt ? updated.endsAt.toISOString() : null,
    allowStaff: updated.allowStaff,
  };

  try {
    await redis.set(REDIS_GLOBAL_KEY, JSON.stringify(state));
  } catch {
    // Ignore redis error
  }

  return state;
}

export async function setTenantMaintenance(
  tenantId: string,
  dto: {
    enabled: boolean;
    readOnly?: boolean;
    message?: string;
    startsAt?: Date;
    endsAt?: Date;
    allowStaff?: boolean;
  },
  staffId?: string,
): Promise<MaintenanceState> {
  const db = primaryDbHandle();
  const [existing] = await db
    .select()
    .from(maintenanceConfig)
    .where(eq(maintenanceConfig.tenantId, tenantId))
    .limit(1);

  let updated: MaintenanceConfig;
  if (existing) {
    const [row] = await db
      .update(maintenanceConfig)
      .set({
        enabled: dto.enabled,
        readOnly: dto.readOnly ?? false,
        message: dto.message ?? null,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        allowStaff: dto.allowStaff ?? true,
        updatedByStaffId: staffId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(maintenanceConfig.id, existing.id))
      .returning();
    if (!row) throw new Error('Failed to update tenant maintenance config');
    updated = row;
  } else {
    const [row] = await db
      .insert(maintenanceConfig)
      .values({
        scope: `TENANT:${tenantId}`,
        tenantId,
        enabled: dto.enabled,
        readOnly: dto.readOnly ?? false,
        message: dto.message ?? null,
        startsAt: dto.startsAt ?? null,
        endsAt: dto.endsAt ?? null,
        allowStaff: dto.allowStaff ?? true,
        updatedByStaffId: staffId ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to create tenant maintenance config');
    updated = row;
  }

  const state: MaintenanceState = {
    enabled: updated.enabled,
    readOnly: updated.readOnly,
    message: updated.message ?? null,
    startsAt: updated.startsAt ? updated.startsAt.toISOString() : null,
    endsAt: updated.endsAt ? updated.endsAt.toISOString() : null,
    allowStaff: updated.allowStaff,
  };

  const redisKey = `${REDIS_TENANT_PREFIX}${tenantId}`;
  try {
    await redis.set(redisKey, JSON.stringify(state));
  } catch {
    // Ignore redis error
  }

  return state;
}
