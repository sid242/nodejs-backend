import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DbExecutor } from '@/config/db';
import { assertTenantScope, primaryDbHandle, tenantDb } from '@/db/tenancy/context';
import { attachUsers } from '@/lib/attach-users';
import {
  roles,
  tenantInvitations,
  tenantMemberRoles,
  tenantMembers,
  tenants,
  users,
  type NewTenantInvitation,
  type TenantInvitation,
  type User,
} from '@/db/schema';

export interface InvitationWithDetails extends TenantInvitation {
  roleName?: string;
  tenantName?: string;
  tenantSlug?: string;
  invitedByName?: string | null;
}

export async function findInvitationByTokenHash(
  tokenHash: string,
  executor: DbExecutor = tenantDb(),
): Promise<InvitationWithDetails | null> {
  const [invitation] = await executor
    .select()
    .from(tenantInvitations)
    .where(eq(tenantInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) return null;

  // Resolve role from tenantDb
  const [role] = await executor
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.id, invitation.roleId))
    .limit(1);

  // Resolve tenant and invitedBy from primaryDb
  const primaryDb = primaryDbHandle();
  const [tenant] = await primaryDb
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, invitation.tenantId))
    .limit(1);

  let invitedByName: string | null = null;
  if (invitation.invitedByUserId) {
    const [inviter] = await primaryDb
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, invitation.invitedByUserId))
      .limit(1);
    invitedByName = inviter ? [inviter.firstName, inviter.lastName].filter(Boolean).join(' ') : null;
  }

  return {
    ...invitation,
    roleName: role?.name,
    tenantName: tenant?.name,
    tenantSlug: tenant?.slug,
    invitedByName,
  };
}

export async function findPendingInvitationByEmail(
  tenantId: string,
  email: string,
  executor: DbExecutor = tenantDb(),
): Promise<TenantInvitation | null> {
  assertTenantScope(tenantId);
  const [row] = await executor
    .select()
    .from(tenantInvitations)
    .where(
      and(
        eq(tenantInvitations.tenantId, tenantId),
        sql`lower(${tenantInvitations.email}) = lower(${email})`,
        eq(tenantInvitations.status, 'PENDING'),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findInvitationById(
  tenantId: string,
  id: string,
  executor: DbExecutor = tenantDb(),
): Promise<InvitationWithDetails | null> {
  assertTenantScope(tenantId);
  const [invitation] = await executor
    .select()
    .from(tenantInvitations)
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.id, id)))
    .limit(1);

  if (!invitation) return null;

  const [role] = await executor
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.id, invitation.roleId))
    .limit(1);

  const primaryDb = primaryDbHandle();
  const [tenant] = await primaryDb
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  let invitedByName: string | null = null;
  if (invitation.invitedByUserId) {
    const [inviter] = await primaryDb
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, invitation.invitedByUserId))
      .limit(1);
    invitedByName = inviter ? [inviter.firstName, inviter.lastName].filter(Boolean).join(' ') : null;
  }

  return {
    ...invitation,
    roleName: role?.name,
    tenantName: tenant?.name,
    tenantSlug: tenant?.slug,
    invitedByName,
  };
}

export async function listInvitations(
  tenantId: string,
  executor: DbExecutor = tenantDb(),
): Promise<InvitationWithDetails[]> {
  assertTenantScope(tenantId);
  const items = await executor
    .select()
    .from(tenantInvitations)
    .where(eq(tenantInvitations.tenantId, tenantId))
    .orderBy(desc(tenantInvitations.createdAt));

  if (!items || items.length === 0) return [];

  // Fetch roles from tenantDb
  const roleIds = [...new Set(items.map((i) => i.roleId))];
  const roleRows = roleIds.length
    ? await executor.select().from(roles).where(inArray(roles.id, roleIds))
    : [];
  const roleMap = new Map(roleRows.map((r) => [r.id, r.name]));

  // Fetch tenant details from primaryDb
  const primaryDb = primaryDbHandle();
  const [tenant] = await primaryDb
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  // Attach inviter names from primaryDb
  const enriched = await attachUsers(items, 'invitedByUserId', 'inviter');

  return enriched.map((item) => ({
    ...item,
    roleName: roleMap.get(item.roleId),
    tenantName: tenant?.name,
    tenantSlug: tenant?.slug,
    invitedByName: item.inviter?.name ?? null,
  }));
}

export async function createInvitation(
  data: NewTenantInvitation,
  executor: DbExecutor = tenantDb(),
): Promise<TenantInvitation> {
  assertTenantScope(data.tenantId);
  const [record] = await executor.insert(tenantInvitations).values(data).returning();
  if (!record) throw new Error('Failed to create invitation record');
  return record;
}

export async function updateInvitation(
  id: string,
  data: Partial<NewTenantInvitation>,
  tenantId?: string,
  executor: DbExecutor = tenantDb(),
): Promise<TenantInvitation | null> {
  assertTenantScope(tenantId);
  const conditions = [eq(tenantInvitations.id, id)];
  if (tenantId) {
    conditions.push(eq(tenantInvitations.tenantId, tenantId));
  }

  const [record] = await executor
    .update(tenantInvitations)
    .set(data)
    .where(and(...conditions))
    .returning();

  return record ?? null;
}

export async function revokeInvitation(
  tenantId: string,
  id: string,
  executor: DbExecutor = tenantDb(),
): Promise<TenantInvitation | null> {
  assertTenantScope(tenantId);
  const [record] = await executor
    .update(tenantInvitations)
    .set({
      status: 'REVOKED',
      revokedAt: new Date(),
    })
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.id, id)))
    .returning();

  return record ?? null;
}

/**
 * Creates user in central Identity Registry (Primary DB ALWAYS)
 */
export async function createInvitedUser(data: {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string | null;
  passwordHash: string;
}): Promise<User> {
  const primaryDb = primaryDbHandle();
  const first = data.firstName ?? (data.name ? data.name.split(' ')[0] : data.email.split('@')[0])!;
  const last = data.lastName ?? (data.name ? data.name.split(' ').slice(1).join(' ') || null : null);
  const [createdUser] = await primaryDb
    .insert(users)
    .values({
      email: data.email,
      firstName: first,
      lastName: last,
      passwordHash: data.passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    })
    .returning();

  if (!createdUser) throw new Error('Failed to create user account');
  return createdUser;
}

/**
 * Executes membership acceptance in tenant database
 */
export async function executeAcceptanceTransaction(
  data: {
    tenantId: string;
    userId: string;
    roleId: string;
    invitationId: string;
    memberMetadata?: {
      memberCode?: string | null;
      phone?: string | null;
      jobTitle?: string | null;
      department?: string | null;
    };
  },
  executor: DbExecutor = tenantDb(),
): Promise<{ memberId: string }> {
  assertTenantScope(data.tenantId);
  return (executor as any).transaction(async (tx: DbExecutor) => {
    // 1. Check if membership exists
    const [existingMember] = await tx
      .select()
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, data.tenantId), eq(tenantMembers.userId, data.userId)))
      .limit(1);

    let memberId: string;

    if (existingMember) {
      await tx
        .update(tenantMembers)
        .set({
          status: 'ACTIVE',
          deletedAt: null,
          ...(data.memberMetadata?.memberCode ? { memberCode: data.memberMetadata.memberCode } : {}),
          ...(data.memberMetadata?.phone ? { phone: data.memberMetadata.phone } : {}),
          ...(data.memberMetadata?.jobTitle ? { jobTitle: data.memberMetadata.jobTitle } : {}),
          ...(data.memberMetadata?.department ? { department: data.memberMetadata.department } : {}),
        })
        .where(eq(tenantMembers.id, existingMember.id));
      memberId = existingMember.id;
    } else {
      const [newMember] = await tx
        .insert(tenantMembers)
        .values({
          tenantId: data.tenantId,
          userId: data.userId,
          status: 'ACTIVE',
          memberCode: data.memberMetadata?.memberCode ?? null,
          phone: data.memberMetadata?.phone ?? null,
          jobTitle: data.memberMetadata?.jobTitle ?? null,
          department: data.memberMetadata?.department ?? null,
        })
        .returning();
      memberId = newMember!.id;
    }

    // 2. Assign role granted by invitation
    await tx
      .insert(tenantMemberRoles)
      .values({ memberId, roleId: data.roleId, tenantId: data.tenantId })
      .onConflictDoNothing();

    // 3. Mark invitation as ACCEPTED
    await tx
      .update(tenantInvitations)
      .set({
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedByUserId: data.userId,
      })
      .where(eq(tenantInvitations.id, data.invitationId));

    return { memberId };
  });
}
