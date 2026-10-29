import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/config/db';
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
): Promise<InvitationWithDetails | null> {
  const [row] = await db
    .select({
      invitation: tenantInvitations,
      roleName: roles.name,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      invitedByName: users.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .innerJoin(roles, eq(tenantInvitations.roleId, roles.id))
    .leftJoin(users, eq(tenantInvitations.invitedByUserId, users.id))
    .where(eq(tenantInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;

  return {
    ...row.invitation,
    roleName: row.roleName,
    tenantName: row.tenantName,
    tenantSlug: row.tenantSlug,
    invitedByName: row.invitedByName,
  };
}

export async function findPendingInvitationByEmail(
  tenantId: string,
  email: string,
): Promise<TenantInvitation | null> {
  const [row] = await db
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
): Promise<InvitationWithDetails | null> {
  const [row] = await db
    .select({
      invitation: tenantInvitations,
      roleName: roles.name,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      invitedByName: users.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .innerJoin(roles, eq(tenantInvitations.roleId, roles.id))
    .leftJoin(users, eq(tenantInvitations.invitedByUserId, users.id))
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.id, id)))
    .limit(1);

  if (!row) return null;

  return {
    ...row.invitation,
    roleName: row.roleName,
    tenantName: row.tenantName,
    tenantSlug: row.tenantSlug,
    invitedByName: row.invitedByName,
  };
}

export async function listInvitations(tenantId: string): Promise<InvitationWithDetails[]> {
  const rows = await db
    .select({
      invitation: tenantInvitations,
      roleName: roles.name,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      invitedByName: users.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .innerJoin(roles, eq(tenantInvitations.roleId, roles.id))
    .leftJoin(users, eq(tenantInvitations.invitedByUserId, users.id))
    .where(eq(tenantInvitations.tenantId, tenantId))
    .orderBy(desc(tenantInvitations.createdAt));

  return (rows ?? []).map((r) => ({
    ...r.invitation,
    roleName: r.roleName,
    tenantName: r.tenantName,
    tenantSlug: r.tenantSlug,
    invitedByName: r.invitedByName,
  }));
}

export async function createInvitation(
  data: NewTenantInvitation,
): Promise<TenantInvitation> {
  const [record] = await db.insert(tenantInvitations).values(data).returning();
  if (!record) throw new Error('Failed to create invitation record');
  return record;
}

export async function updateInvitation(
  id: string,
  data: Partial<NewTenantInvitation>,
): Promise<TenantInvitation | null> {
  const [record] = await db
    .update(tenantInvitations)
    .set(data)
    .where(eq(tenantInvitations.id, id))
    .returning();

  return record ?? null;
}

export async function revokeInvitation(
  tenantId: string,
  id: string,
): Promise<TenantInvitation | null> {
  const [record] = await db
    .update(tenantInvitations)
    .set({
      status: 'REVOKED',
      revokedAt: new Date(),
    })
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.id, id)))
    .returning();

  return record ?? null;
}

export async function createInvitedUser(data: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<User> {
  const [createdUser] = await db
    .insert(users)
    .values({
      email: data.email,
      name: data.name,
      passwordHash: data.passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    })
    .returning();

  if (!createdUser) throw new Error('Failed to create user account');
  return createdUser;
}

export async function executeAcceptanceTransaction(data: {
  tenantId: string;
  userId: string;
  roleId: string;
  invitationId: string;
}): Promise<{ memberId: string }> {
  return db.transaction(async (tx) => {
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
        .set({ status: 'ACTIVE' })
        .where(eq(tenantMembers.id, existingMember.id));
      memberId = existingMember.id;
    } else {
      const [newMember] = await tx
        .insert(tenantMembers)
        .values({
          tenantId: data.tenantId,
          userId: data.userId,
          status: 'ACTIVE',
        })
        .returning();
      memberId = newMember!.id;
    }

    // 2. Assign the role granted by the invitation
    await tx
      .insert(tenantMemberRoles)
      .values({ memberId, roleId: data.roleId })
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

