import { and, desc, eq, sql } from 'drizzle-orm';

import {
  tenantScimTokens,
  tenantSsoConfigs,
  type NewTenantScimToken,
  type NewTenantSsoConfig,
  type TenantScimToken,
  type TenantSsoConfig,
} from '@/db/schema/index';
import {
  assertTenantScope,
  currentTenantCtx,
  primaryDbHandle,
  tenantDb,
} from '@/db/tenancy/context';

export class SsoRepository {
  async findConfigByTenantId(tenantId: string): Promise<TenantSsoConfig | null> {
    assertTenantScope(tenantId);
    const [config] = await tenantDb()
      .select()
      .from(tenantSsoConfigs)
      .where(eq(tenantSsoConfigs.tenantId, tenantId))
      .limit(1);

    if (config) return config;

    // Fallback to primary registry if tenant context was not yet bound to dedicated
    const [primaryConfig] = await primaryDbHandle()
      .select()
      .from(tenantSsoConfigs)
      .where(eq(tenantSsoConfigs.tenantId, tenantId))
      .limit(1);

    return primaryConfig ?? null;
  }

  async recordConnectionTest(
    tenantId: string,
    configUpdatedAt: Date,
    succeeded: boolean,
  ): Promise<void> {
    assertTenantScope(tenantId);
    await tenantDb()
      .update(tenantSsoConfigs)
      .set({
        lastConnectionTestAt: new Date(),
        lastConnectionTestSucceeded: succeeded,
        updatedAt: sql`${tenantSsoConfigs.updatedAt}`,
      })
      .where(
        and(
          eq(tenantSsoConfigs.tenantId, tenantId),
          sql`date_trunc('milliseconds', ${tenantSsoConfigs.updatedAt}) = ${configUpdatedAt.toISOString()}::timestamptz`,
        ),
      );
  }

  async findActiveConfigByDomain(domain: string): Promise<TenantSsoConfig | null> {
    const normalized = domain?.trim()?.toLowerCase();
    if (!normalized) return null;

    // Domain lookup occurs pre-login on primary registry
    const [config] = await primaryDbHandle()
      .select()
      .from(tenantSsoConfigs)
      .where(
        and(
          eq(tenantSsoConfigs.status, 'ACTIVE'),
          sql`${normalized} = ANY(${tenantSsoConfigs.allowedDomains})`,
        ),
      )
      .limit(1);

    return config ?? null;
  }

  async upsertConfig(
    tenantId: string,
    data: Partial<NewTenantSsoConfig>,
  ): Promise<TenantSsoConfig> {
    assertTenantScope(tenantId);
    const targetDb = tenantDb();
    const [config] = await targetDb
      .insert(tenantSsoConfigs)
      .values({
        tenantId,
        ...data,
      })
      .onConflictDoUpdate({
        target: tenantSsoConfigs.tenantId,
        set: {
          ...data,
          updatedAt: new Date(),
        },
      })
      .returning();

    // If dedicated, also maintain primary registry record for domain lookup pre-login
    if (targetDb !== primaryDbHandle()) {
      await primaryDbHandle()
        .insert(tenantSsoConfigs)
        .values({
          tenantId,
          ...data,
        })
        .onConflictDoUpdate({
          target: tenantSsoConfigs.tenantId,
          set: {
            ...data,
            updatedAt: new Date(),
          },
        });
    }

    return config!;
  }

  async createScimToken(data: NewTenantScimToken): Promise<TenantScimToken> {
    assertTenantScope(data.tenantId);
    const [token] = await tenantDb().insert(tenantScimTokens).values(data).returning();
    return token!;
  }

  async findScimTokenByHash(tokenHash: string): Promise<TenantScimToken | null> {
    const target = currentTenantCtx()?.tenantId ? tenantDb() : primaryDbHandle();
    const [token] = await target
      .select()
      .from(tenantScimTokens)
      .where(eq(tenantScimTokens.tokenHash, tokenHash))
      .limit(1);

    return token ?? null;
  }

  async findScimTokenById(tenantId: string, id: string): Promise<TenantScimToken | null> {
    assertTenantScope(tenantId);
    const [token] = await tenantDb()
      .select()
      .from(tenantScimTokens)
      .where(and(eq(tenantScimTokens.tenantId, tenantId), eq(tenantScimTokens.id, id)))
      .limit(1);
    return token ?? null;
  }

  async listScimTokens(tenantId: string): Promise<TenantScimToken[]> {
    assertTenantScope(tenantId);
    return tenantDb()
      .select()
      .from(tenantScimTokens)
      .where(eq(tenantScimTokens.tenantId, tenantId))
      .orderBy(desc(tenantScimTokens.createdAt));
  }

  async updateScimTokenLastUsed(id: string, ip?: string): Promise<void> {
    const target = currentTenantCtx()?.tenantId ? tenantDb() : primaryDbHandle();
    const payload: Record<string, any> = { lastUsedAt: new Date() };
    if (ip) {
      payload.lastUsedIp = ip;
    }
    await target.update(tenantScimTokens).set(payload).where(eq(tenantScimTokens.id, id));
  }

  async rotateScimToken(
    tenantId: string,
    id: string,
    tokenHash: string,
    tokenPrefix: string,
    expiresAt: Date | null,
  ): Promise<TenantScimToken | null> {
    assertTenantScope(tenantId);
    const [rotated] = await tenantDb()
      .update(tenantScimTokens)
      .set({
        tokenHash,
        tokenPrefix,
        expiresAt,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(and(eq(tenantScimTokens.tenantId, tenantId), eq(tenantScimTokens.id, id)))
      .returning();
    return rotated ?? null;
  }

  async revokeScimToken(tenantId: string, id: string): Promise<boolean> {
    assertTenantScope(tenantId);
    const result = await tenantDb()
      .update(tenantScimTokens)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(tenantScimTokens.tenantId, tenantId), eq(tenantScimTokens.id, id)))
      .returning({ id: tenantScimTokens.id });

    return (result?.length ?? 0) > 0;
  }
}

export const ssoRepo = new SsoRepository();
