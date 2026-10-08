import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '@/config/env.js';
import { redis } from '@/config/redis.js';
import { AppError } from '@/lib/errors.js';

const refreshKey = (userId: string, jti: string): string => `rt:${userId}:${jti}`;

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

const PASSWORD_RESET_TTL_SECONDS = 15 * 60; // 15 minutes
const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomUUID();
  await redis.set(`prt:${token}`, userId, 'EX', PASSWORD_RESET_TTL_SECONDS);
  return token;
}

export async function verifyAndConsumePasswordResetToken(token: string): Promise<string> {
  let userId: string | null = null;
  if (typeof (redis as any).getdel === 'function') {
    userId = await (redis as any).getdel(`prt:${token}`);
  } else {
    userId = await redis.get(`prt:${token}`);
    if (userId) await redis.del(`prt:${token}`);
  }
  if (!userId) throw AppError.badRequest('Password reset token is invalid or has expired');
  return userId;
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = randomUUID();
  await redis.set(`evt:${token}`, userId, 'EX', EMAIL_VERIFICATION_TTL_SECONDS);
  return token;
}

export async function verifyAndConsumeEmailVerificationToken(token: string): Promise<string> {
  let userId: string | null = null;
  if (typeof (redis as any).getdel === 'function') {
    userId = await (redis as any).getdel(`evt:${token}`);
  } else {
    userId = await redis.get(`evt:${token}`);
    if (userId) await redis.del(`evt:${token}`);
  }
  if (!userId) throw AppError.badRequest('Email verification token is invalid or has expired');
  return userId;
}
