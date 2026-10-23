import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '@/config/env.js';
import { redis } from '@/config/redis.js';
import { REDIS_PREFIXES, TOKEN_EXPIRATION } from '@/constants/index.js';
import { AppError } from '@/lib/errors.js';

import {
  createHashedVerificationToken,
  verifyAndConsumeHashedToken,
} from './verification.repository.js';

const refreshKey = (userId: string, jti: string): string =>
  `${REDIS_PREFIXES.REFRESH_TOKEN}${userId}:${jti}`;

export interface TokenUser {
  id: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

const signAccessToken = (user: TokenUser): string =>
  jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_TTL as any,
  });

/** Short-lived stateless access token + long-lived refresh token tracked in Redis (revocable). */
export async function issueTokens(user: TokenUser): Promise<AuthTokens> {
  const jti = randomUUID();
  const refreshToken = jwt.sign({}, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    jwtid: jti,
    expiresIn: env.JWT_REFRESH_TTL_SECONDS,
  });
  await redis.set(refreshKey(user.id, jti), '1', 'EX', env.JWT_REFRESH_TTL_SECONDS);
  return { accessToken: signAccessToken(user), refreshToken };
}

/** One-time use: deleting the key makes replaying an old refresh token fail. */
export async function consumeRefreshToken(token: string): Promise<string> {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
  if (!payload.sub || !payload.jti) throw AppError.unauthorized('Invalid refresh token');
  const deleted = await redis.del(refreshKey(payload.sub, payload.jti));
  if (!deleted) throw AppError.unauthorized('Refresh token revoked or already used');
  return payload.sub;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
    if (payload.sub && payload.jti) {
      await redis.del(refreshKey(payload.sub, payload.jti));
    }
  } catch {
    /* already invalid: nothing to revoke */
  }
}

/** Revoke all active refresh tokens for a user (e.g. on password reset). */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  try {
    const stream = redis.scanStream({ match: `rt:${userId}:*`, count: 100 });
    for await (const keys of stream) {
      if (keys.length) await redis.unlink(keys);
    }
  } catch {
    /* ignore redis scan failures during revocation */
  }
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const { rawToken } = await createHashedVerificationToken({
    userId,
    type: 'PASSWORD_RESET',
    ttlSeconds: TOKEN_EXPIRATION.PASSWORD_RESET_SECONDS,
  });
  return rawToken;
}

export async function verifyAndConsumePasswordResetToken(token: string): Promise<string> {
  const record = await verifyAndConsumeHashedToken(token, 'PASSWORD_RESET');
  return record.userId;
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const { rawToken } = await createHashedVerificationToken({
    userId,
    type: 'EMAIL_VERIFICATION',
    ttlSeconds: TOKEN_EXPIRATION.EMAIL_VERIFICATION_SECONDS,
  });
  return rawToken;
}

export async function verifyAndConsumeEmailVerificationToken(token: string): Promise<string> {
  const record = await verifyAndConsumeHashedToken(token, 'EMAIL_VERIFICATION');
  return record.userId;
}

export interface MagicLinkVerificationResult {
  userId: string;
  target?: string | null;
}

export async function createMagicLinkToken(
  userId: string,
  ttlSeconds = 15 * 60,
  target?: string,
): Promise<string> {
  const { rawToken } = await createHashedVerificationToken({
    userId,
    type: 'MAGIC_LINK',
    target,
    ttlSeconds,
  });
  return rawToken;
}

export async function verifyAndConsumeMagicLinkToken(
  token: string,
): Promise<MagicLinkVerificationResult> {
  const record = await verifyAndConsumeHashedToken(token, 'MAGIC_LINK');
  return { userId: record.userId, target: record.target };
}

export interface ImpersonatorClaim {
  userId: string;
  role: string;
  reason: string;
  sessionId: string;
}

const impersonationSessionKey = (sessionId: string): string =>
  `${REDIS_PREFIXES.IMPERSONATION_SESSION}${sessionId}`;

/**
 * Issue a time-boxed, short-lived impersonation access token.
 * Does NOT generate a refresh token, ensuring strict session limits.
 */
export async function issueImpersonationToken(
  targetUser: TokenUser,
  impersonator: ImpersonatorClaim,
  durationMinutes = 30,
): Promise<{ accessToken: string; sessionId: string; expiresInSeconds: number }> {
  const ttlSeconds = durationMinutes * 60;
  const accessToken = jwt.sign(
    {
      role: targetUser.role,
      impersonator,
    },
    env.JWT_ACCESS_SECRET,
    {
      subject: targetUser.id,
      expiresIn: `${ttlSeconds}s` as any,
    },
  );

  try {
    await redis.set(
      impersonationSessionKey(impersonator.sessionId),
      JSON.stringify({
        targetUserId: targetUser.id,
        adminId: impersonator.userId,
        reason: impersonator.reason,
        createdAt: new Date().toISOString(),
      }),
      'EX',
      ttlSeconds,
    );
  } catch {
    /* ignore redis write errors if redis is disconnected */
  }

  return { accessToken, sessionId: impersonator.sessionId, expiresInSeconds: ttlSeconds };
}

/** Check if the active impersonation session key exists in Redis. */
export async function isImpersonationSessionActive(sessionId: string): Promise<boolean> {
  if (redis.status !== 'ready' && redis.status !== 'connect') {
    // If Redis is offline/disconnected, fail-open to token expiry
    return true;
  }
  try {
    const exists = await redis.exists(impersonationSessionKey(sessionId));
    return exists === 1;
  } catch {
    return true;
  }
}

/** Revoke an active impersonation session immediately. */
export async function revokeImpersonationSession(sessionId: string): Promise<void> {
  if (redis.status !== 'ready' && redis.status !== 'connect') {
    return;
  }
  try {
    await redis.del(impersonationSessionKey(sessionId));
  } catch {
    /* ignore redis delete errors */
  }
}
