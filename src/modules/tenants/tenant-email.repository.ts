import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  tenantEmailConfigs,
  type NewTenantEmailConfig,
  type TenantEmailConfig,
} from '@/db/schema/index';

export async function findTenantEmailConfig(tenantId: string): Promise<TenantEmailConfig | null> {
  const [record] = await db
    .select()
    .from(tenantEmailConfigs)
    .where(eq(tenantEmailConfigs.tenantId, tenantId))
    .limit(1);
  return record ?? null;
}

export async function upsertTenantEmailConfig(
  data: NewTenantEmailConfig,
): Promise<TenantEmailConfig> {
  const [record] = await db
    .insert(tenantEmailConfigs)
    .values(data)
    .onConflictDoUpdate({
      target: tenantEmailConfigs.tenantId,
      set: {
        host: data.host,
        port: data.port,
        secure: data.secure,
        user: data.user,
        passwordEncrypted: data.passwordEncrypted,
        fromEmail: data.fromEmail,
        fromName: data.fromName,
        replyTo: data.replyTo,
        isEnabled: data.isEnabled,
        updatedAt: new Date(),
      },
    })
    .returning();
  return record!;
}

export async function deleteTenantEmailConfig(tenantId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(tenantEmailConfigs)
    .where(eq(tenantEmailConfigs.tenantId, tenantId))
    .returning();
  return !!deleted;
}

export const tenantEmailRepo = {
  findTenantEmailConfig,
  upsertTenantEmailConfig,
  deleteTenantEmailConfig,
};
