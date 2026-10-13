import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { sessions, type SessionRecord } from '@/db/schema/index.js';
import { hashToken } from './verification.repository.js';

export interface CreateSessionParams {
  userId: string;
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
  deviceType?: string;
  expiresInSeconds: number;
}

export async function createSessionRecord({
  userId,
  refreshToken,
  userAgent,
  ipAddress,
  deviceType,
  expiresInSeconds,
}: CreateSessionParams): Promise<SessionRecord> {
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      refreshTokenHash,
      userAgent,
      ipAddress,
      deviceType,
      expiresAt,
    })
    .returning();

  return session!;
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

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.update(sessions).set({ isRevoked: true }).where(eq(sessions.userId, userId));
}
