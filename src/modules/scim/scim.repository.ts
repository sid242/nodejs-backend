import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';

import { tenantMembers, users } from '@/db/schema/index';
import { assertTenantScope, primaryDbHandle, tenantDb } from '@/db/tenancy/context';

export interface ScimListMembersOptions {
  startIndex: number;
  count: number;
  externalId?: string;
}

export class ScimRepository {
  async findMemberByUserId(tenantId: string, userId: string) {
    assertTenantScope(tenantId);
    const [member] = await tenantDb()
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.userId, userId),
          isNull(tenantMembers.deletedAt),
        ),
      )
      .limit(1);

    return member ?? null;
  }

  async findMemberByExternalId(tenantId: string, externalId: string) {
    assertTenantScope(tenantId);
    const [member] = await tenantDb()
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.externalId, externalId),
          isNull(tenantMembers.deletedAt),
        ),
      )
      .limit(1);

    return member ?? null;
  }

  async listMembers(tenantId: string, options: ScimListMembersOptions) {
    assertTenantScope(tenantId);

    const conditions = [
      eq(tenantMembers.tenantId, tenantId),
      isNull(tenantMembers.deletedAt),
    ];

    if (options.externalId) {
      conditions.push(eq(tenantMembers.externalId, options.externalId));
    }

    const [totalRow] = await tenantDb()
      .select({ count: count() })
      .from(tenantMembers)
      .where(and(...conditions));

    const total = Number(totalRow?.count ?? 0);

    const offset = Math.max(0, options.startIndex - 1);
    const members = await tenantDb()
      .select()
      .from(tenantMembers)
      .where(and(...conditions))
      .orderBy(desc(tenantMembers.createdAt))
      .limit(options.count)
      .offset(offset);

    return {
      total,
      members,
    };
  }

  async createMember(data: {
    tenantId: string;
    userId: string;
    status: 'ACTIVE' | 'SUSPENDED';
    externalId?: string;
  }) {
    assertTenantScope(data.tenantId);
    const [member] = await tenantDb()
      .insert(tenantMembers)
      .values({
        tenantId: data.tenantId,
        userId: data.userId,
        status: data.status,
        externalId: data.externalId ?? null,
        joinedAt: new Date(),
      })
      .returning();

    return member!;
  }

  async updateMember(
    tenantId: string,
    memberId: string,
    data: {
      status?: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
      externalId?: string | null;
      tokenVersion?: number;
      statusChangedAt?: Date | null;
    },
  ) {
    assertTenantScope(tenantId);
    const updatePayload: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.status !== undefined) {
      updatePayload.status = data.status;
    }
    if (data.externalId !== undefined) {
      updatePayload.externalId = data.externalId;
    }
    if (data.tokenVersion !== undefined) {
      updatePayload.tokenVersion = data.tokenVersion;
    }
    if (data.statusChangedAt !== undefined) {
      updatePayload.statusChangedAt = data.statusChangedAt;
    }

    const [updated] = await tenantDb()
      .update(tenantMembers)
      .set(updatePayload)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.id, memberId)))
      .returning();

    return updated ?? null;
  }

  async removeMember(tenantId: string, memberId: string) {
    assertTenantScope(tenantId);
    const [deleted] = await tenantDb()
      .update(tenantMembers)
      .set({
        deletedAt: new Date(),
        status: 'SUSPENDED',
        tokenVersion: 9999,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.id, memberId)))
      .returning();

    return deleted ?? null;
  }

  // Primary Database Identity Lookups (Primary DB Handle)
  async findUserById(userId: string) {
    const [user] = await primaryDbHandle()
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    return user ?? null;
  }

  async findUserByEmail(email: string) {
    const [user] = await primaryDbHandle()
      .select()
      .from(users)
      .where(and(eq(users.email, email.trim().toLowerCase()), isNull(users.deletedAt)))
      .limit(1);

    return user ?? null;
  }

  async findUsersByIds(userIds: string[]) {
    if (!userIds.length) return [];
    return primaryDbHandle()
      .select()
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
  }

  async createManagedUser(data: {
    email: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    authMethod?: 'SCIM' | 'SSO' | 'PASSWORD';
    status?: 'ACTIVE' | 'PENDING_VERIFICATION';
  }) {
    const first =
      data.firstName ?? (data.name ? data.name.split(' ')[0] : data.email.split('@')[0])!;
    const last =
      data.lastName ?? (data.name ? data.name.split(' ').slice(1).join(' ') || 'User' : 'User');

    const [created] = await primaryDbHandle()
      .insert(users)
      .values({
        email: data.email.trim().toLowerCase(),
        firstName: first,
        lastName: last,
        passwordHash: null,
        status: data.status ?? 'ACTIVE',
        authMethod: data.authMethod ?? 'SCIM',
        emailVerifiedAt: new Date(),
      })
      .returning();

    return created!;
  }

  async updateUserDisplayName(userId: string, name: string) {
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] ?? name;
    const lastName = parts.slice(1).join(' ') || 'User';

    const [updated] = await primaryDbHandle()
      .update(users)
      .set({
        firstName,
        lastName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return updated ?? null;
  }
}

export const scimRepo = new ScimRepository();
