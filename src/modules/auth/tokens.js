import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { redis } from '../../config/redis.js';
import { AppError } from '../../lib/errors.js';

const refreshKey = (userId, jti) => `rt:${userId}:${jti}`;

export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_ACCESS_SECRET);

const signAccessToken = (user) =>
  jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_TTL,
  });

/** Short-lived stateless access token + long-lived refresh token tracked in Redis (revocable). */
export async function issueTokens(user) {
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
export async function consumeRefreshToken(token) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  const deleted = await redis.del(refreshKey(payload.sub, payload.jti));
  if (!deleted) throw AppError.unauthorized('Refresh token revoked or already used');
  return payload.sub;
}

export async function revokeRefreshToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
    await redis.del(refreshKey(payload.sub, payload.jti));
  } catch {
    /* already invalid: nothing to revoke */
  }
}

/** Revoke all active refresh tokens for a user (e.g. on password reset). */
export async function revokeAllUserTokens(userId) {
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

export async function createPasswordResetToken(userId) {
  const token = randomUUID();
  await redis.set(`prt:${token}`, userId, 'EX', PASSWORD_RESET_TTL_SECONDS);
  return token;
}

export async function verifyAndConsumePasswordResetToken(token) {
  let userId = null;
  if (typeof redis.getdel === 'function') {
    userId = await redis.getdel(`prt:${token}`);
  } else {
    userId = await redis.get(`prt:${token}`);
    if (userId) await redis.del(`prt:${token}`);
  }
  if (!userId) throw AppError.badRequest('Password reset token is invalid or has expired');
  return userId;
}

export async function createEmailVerificationToken(userId) {
  const token = randomUUID();
  await redis.set(`evt:${token}`, userId, 'EX', EMAIL_VERIFICATION_TTL_SECONDS);
  return token;
}

export async function verifyAndConsumeEmailVerificationToken(token) {
  let userId = null;
  if (typeof redis.getdel === 'function') {
    userId = await redis.getdel(`evt:${token}`);
  } else {
    userId = await redis.get(`evt:${token}`);
    if (userId) await redis.del(`evt:${token}`);
  }
  if (!userId) throw AppError.badRequest('Email verification token is invalid or has expired');
  return userId;
}
