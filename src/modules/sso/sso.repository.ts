import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import {
  NewTenantScimToken,
  NewTenantSsoConfig,
  TenantScimToken,
  tenantScimTokens,
  TenantSsoConfig,
  tenantSsoConfigs,
} from '@/db/schema/index';

export class SsoRepository {
  async findConfigByTenantId(tenantId: string): Promise<TenantSsoConfig | null> {
    const [config] = await db
      .select()
      .from(tenantSsoConfigs)
      .where(eq(tenantSsoConfigs.tenantId, tenantId))
      .limit(1);

    return config ?? null;
  }

  async findActiveConfigByDomain(domain: string): Promise<TenantSsoConfig | null> {
    const normalized = domain?.trim()?.toLowerCase();
    if (!normalized) return null;

    const [config] = await db
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
    const [config] = await db
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

    return config!;
  }

  async createScimToken(data: NewTenantScimToken): Promise<TenantScimToken> {
    const [token] = await db.insert(tenantScimTokens).values(data).returning();
    return token!;
  }

  async findScimTokenByHash(tokenHash: string): Promise<TenantScimToken | null> {
    const [token] = await db
      .select()
      .from(tenantScimTokens)
      .where(eq(tenantScimTokens.tokenHash, tokenHash))
      .limit(1);

    return token ?? null;
  }

  async listScimTokens(tenantId: string): Promise<TenantScimToken[]> {
    return db
      .select()
      .from(tenantScimTokens)
      .where(eq(tenantScimTokens.tenantId, tenantId))
      .orderBy(desc(tenantScimTokens.createdAt));
  }

  async updateScimTokenLastUsed(id: string): Promise<void> {
    await db
      .update(tenantScimTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(tenantScimTokens.id, id));
  }

  async revokeScimToken(tenantId: string, id: string): Promise<boolean> {
    const result = await db
      .update(tenantScimTokens)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(and(eq(tenantScimTokens.tenantId, tenantId), eq(tenantScimTokens.id, id)))
      .returning({ id: tenantScimTokens.id });

    return (result?.length ?? 0) > 0;
  }
}

export const ssoRepo = new SsoRepository();
