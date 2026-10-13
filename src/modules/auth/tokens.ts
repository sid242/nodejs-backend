import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '@/config/env.js';
import { redis } from '@/config/redis.js';
import { AppError } from '@/lib/errors.js';
import { REDIS_PREFIXES, TOKEN_EXPIRATION } from '@/constants/index.js';
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
