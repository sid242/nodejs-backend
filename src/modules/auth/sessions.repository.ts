import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';

import { db } from '@/config/db';
import { sessions, type SessionRecord } from '@/db/schema/index';

import { hashToken } from './verification.repository';

export interface CreateSessionParams {
  userId: string;
  refreshToken: string;
  familyId?: string;
  userAgent?: string;
  ipAddress?: string;
  deviceType?: string;
  deviceName?: string;
  country?: string;
  city?: string;
  expiresInSeconds: number;
}

export async function createSessionRecord({
  userId,
  refreshToken,
  familyId,
  userAgent,
  ipAddress,
  deviceType,
  deviceName,
  country,
  city,
  expiresInSeconds,
}: CreateSessionParams): Promise<SessionRecord> {
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const assignedFamilyId = familyId ?? randomUUID();

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      refreshTokenHash,
      familyId: assignedFamilyId,
      userAgent,
      ipAddress,
      deviceType,
      deviceName,
      country,
      city,
      expiresAt,
    })
    .returning();

  return session!;
}

export async function findSessionByRefreshTokenHash(
  refreshTokenHash: string,
): Promise<SessionRecord | null> {
  const [record] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, refreshTokenHash))
    .limit(1);

  return record ?? null;
}

export async function findSessionById(sessionId: string): Promise<SessionRecord | null> {
  const [record] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return record ?? null;
}

export async function findUserActiveSessions(userId: string): Promise<SessionRecord[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.isRevoked, false)))
    .orderBy(desc(sessions.lastActiveAt));
}

export async function revokeSessionById(sessionId: string, userId: string): Promise<boolean> {
  const [updated] = await db
    .update(sessions)
    .set({ isRevoked: true })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning();

  return !!updated;
}

export async function revokeSessionFamily(familyId: string): Promise<void> {
  await db.update(sessions).set({ isRevoked: true }).where(eq(sessions.familyId, familyId));
}

export async function revokeOtherUserSessions(
  userId: string,
  keepSessionId?: string,
): Promise<number> {
  const condition = keepSessionId
    ? and(eq(sessions.userId, userId), eq(sessions.isRevoked, false), ne(sessions.id, keepSessionId))
    : and(eq(sessions.userId, userId), eq(sessions.isRevoked, false));

  const updated = await db.update(sessions).set({ isRevoked: true }).where(condition).returning();

  return updated.length;
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(sessions).set({ isRevoked: true }).where(eq(sessions.userId, userId));
}

export async function markSessionRotated(
  sessionId: string,
  replacedBySessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      isRevoked: true,
      rotatedAt: new Date(),
      replacedBy: replacedBySessionId,
    })
    .where(eq(sessions.id, sessionId));
}

export async function touchSessionActive(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessions.id, sessionId));
}
