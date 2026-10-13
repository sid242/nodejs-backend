import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { redis } from '@/config/redis.js';
import { verificationTokens, type VerificationToken } from '@/db/schema/index.js';
import { AppError } from '@/lib/errors.js';
import { REDIS_PREFIXES } from '@/constants/index.js';

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export interface CreateTokenParams {
  userId: string;
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'EMAIL_CHANGE' | 'PHONE_OTP' | 'MAGIC_LINK';
  target?: string;
  ttlSeconds: number;
}

export async function createHashedVerificationToken({
  userId,
  type,
  target,
  ttlSeconds,
}: CreateTokenParams): Promise<{ rawToken: string; tokenRecord: VerificationToken }> {
  const rawToken = crypto.randomUUID();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const [tokenRecord] = await db
    .insert(verificationTokens)
    .values({
      userId,
      tokenHash,
      type,
      target,
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
    })
    .returning();

  if (!tokenRecord) {
    throw AppError.internal('Failed to persist verification token');
  }

  // Cache in Redis for ultra-fast lookup with TTL
  const cacheKey = `${REDIS_PREFIXES.EMAIL_VERIFICATION}hash:${tokenHash}`;
  await redis.set(cacheKey, JSON.stringify({ userId, type, id: tokenRecord.id }), 'EX', ttlSeconds);

  return { rawToken, tokenRecord };
}

export async function verifyAndConsumeHashedToken(
  rawToken: string,
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'EMAIL_CHANGE' | 'PHONE_OTP' | 'MAGIC_LINK',
): Promise<VerificationToken> {
  const tokenHash = hashToken(rawToken);

  const [tokenRecord] = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, tokenHash), eq(verificationTokens.type, type)))
    .limit(1);

  if (!tokenRecord) {
    throw AppError.badRequest('Verification token is invalid or has expired');
  }

  if (tokenRecord.usedAt) {
    throw AppError.badRequest('Verification token has already been used');
  }

  if (tokenRecord.attempts >= tokenRecord.maxAttempts) {
    throw AppError.badRequest(
      'Maximum verification attempts exceeded. Please request a new token.',
    );
  }

  if (tokenRecord.expiresAt < new Date()) {
    throw AppError.badRequest('Verification token has expired');
  }

  // Atomically mark token as used
  const [updated] = await db
    .update(verificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(verificationTokens.id, tokenRecord.id))
    .returning();

  if (!updated) {
    throw AppError.internal('Failed to consume verification token');
  }

  // Remove from Redis cache
  const cacheKey = `${REDIS_PREFIXES.EMAIL_VERIFICATION}hash:${tokenHash}`;
  await redis.del(cacheKey);

  return updated;
}
