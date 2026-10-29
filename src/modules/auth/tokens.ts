import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { REDIS_PREFIXES, TOKEN_EXPIRATION } from '@/constants/index';
import { AppError } from '@/lib/errors';

import {
  createHashedVerificationToken,
  verifyAndConsumeHashedToken,
} from './verification.repository';

const refreshKey = (userId: string, jti: string): string =>
  `${REDIS_PREFIXES.REFRESH_TOKEN}${userId}:${jti}`;

export interface TokenUser {
  id: string;
}

export interface AccessTokenPayload extends JwtPayload {
  sub?: string;
  typ?: string;
  aud?: string | string[];
}

export interface SupportTokenPayload extends JwtPayload {
  typ: 'SUPPORT';
  sess: string;
  staffId: string;
  tenantId: string;
  mode: 'TENANT_SCOPED' | 'AS_MEMBER';
  scope: 'READ_ONLY' | 'FULL';
  sub?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: 'customer-api' }) as AccessTokenPayload;

export function issueSupportToken(
  claims: {
    sess: string;
    staffId: string;
    tenantId: string;
    mode: 'TENANT_SCOPED' | 'AS_MEMBER';
    scope: 'READ_ONLY' | 'FULL';
    targetUserId?: string | null;
  },
  durationMinutes = 30,
): { token: string; expiresInSeconds: number } {
  const ttlSeconds = Math.max(60, Math.floor(durationMinutes * 60));
  const token = jwt.sign(
    {
      typ: 'SUPPORT',
      sess: claims.sess,
      staffId: claims.staffId,
      tenantId: claims.tenantId,
      mode: claims.mode,
      scope: claims.scope,
    },
    env.JWT_SUPPORT_SECRET,
    {
      subject: claims.targetUserId || claims.staffId,
      audience: 'customer-api',
      expiresIn: ttlSeconds,
    },
  );
  return { token, expiresInSeconds: ttlSeconds };
}

export function verifySupportToken(token: string): SupportTokenPayload {
  const payload = jwt.verify(token, env.JWT_SUPPORT_SECRET, {
    audience: 'customer-api',
  }) as SupportTokenPayload;
  if (payload.typ !== 'SUPPORT' || !payload.sess || !payload.staffId || !payload.tenantId) {
    throw AppError.unauthorized('Invalid support token payload');
  }
  return payload;
}

const signAccessToken = (user: TokenUser): string =>
  jwt.sign({ typ: 'USER' }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    audience: 'customer-api',
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
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
