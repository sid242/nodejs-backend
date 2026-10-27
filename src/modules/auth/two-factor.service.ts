import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Secret, TOTP } from 'otpauth';

import { redis } from '@/config/redis.js';
import { AUTH_MESSAGES, REDIS_PREFIXES, TOKEN_EXPIRATION } from '@/constants/index.js';
import type { PublicUser } from '@/db/schema/index.js';
import { cache } from '@/lib/cache.js';
import { decrypt, encrypt } from '@/lib/crypto.js';
import { AppError } from '@/lib/errors.js';
import * as authRepo from '@/modules/auth/auth.repository.js';
import { issueTokens, type AuthTokens } from '@/modules/auth/tokens.js';
import {
  createHashedVerificationToken,
  verifyAndConsumeHashedToken,
} from '@/modules/auth/verification.repository.js';

const APP_NAME = 'App';
const RECOVERY_CODE_COUNT = 8;

// ─── Setup ──────────────────────────────────────────────────────────────────────

export interface TwoFactorSetupResult {
  otpauthUri: string;
  secret: string; // Base32-encoded secret for manual entry
}

/**
 * Generates a pending TOTP secret and stores it in Redis (not in the DB yet).
 * The user must verify the secret by entering a valid code before it's persisted.
 */
export async function setupTwoFactor(userId: string): Promise<TwoFactorSetupResult> {
  const user = await authRepo.findPublicUserById(userId);
  if (!user) throw AppError.notFound('User not found');

  if (user.twoFactorEnabledAt) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_ALREADY_ENABLED);
  }

  const secret = new Secret();
  const totp = new TOTP({
    issuer: APP_NAME,
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  // Store the pending secret in Redis with TTL (not persisted to DB until confirmed)
  const redisKey = `${REDIS_PREFIXES.TWO_FACTOR_PENDING_SECRET}${userId}`;
  await redis.set(redisKey, secret.base32, 'EX', TOKEN_EXPIRATION.TWO_FACTOR_PENDING_SECONDS);

  return {
    otpauthUri: totp.toString(),
    secret: secret.base32,
  };
}

// ─── Enable ─────────────────────────────────────────────────────────────────────

export interface TwoFactorEnableResult {
  recoveryCodes: string[];
  message: string;
}

/**
 * Validates a TOTP code against the pending secret, persists the encrypted secret
 * to the database, and generates recovery codes.
 */
export async function enableTwoFactor(
  userId: string,
  code: string,
): Promise<TwoFactorEnableResult> {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) throw AppError.notFound('User not found');

  if (user.twoFactorEnabledAt) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_ALREADY_ENABLED);
  }

  // Retrieve pending secret from Redis
  const redisKey = `${REDIS_PREFIXES.TWO_FACTOR_PENDING_SECRET}${userId}`;
  const pendingSecret = await redis.get(redisKey);
  if (!pendingSecret) {
    throw AppError.badRequest('No pending 2FA setup found. Please start the setup process again.');
  }

  // Validate the TOTP code against the pending secret
  const secret = Secret.fromBase32(pendingSecret);
  const totp = new TOTP({
    issuer: APP_NAME,
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  // Generate recovery codes
  const rawRecoveryCodes: string[] = [];
  const hashedRecoveryCodes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const rawCode = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    rawRecoveryCodes.push(rawCode);
    hashedRecoveryCodes.push(await bcrypt.hash(rawCode, 10));
  }

  // Persist encrypted secret + hashed recovery codes to DB
  const encryptedSecret = encrypt(pendingSecret);
  await authRepo.enableTwoFactor(userId, encryptedSecret, hashedRecoveryCodes);

  // Cleanup Redis pending secret
  await redis.del(redisKey);
  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);

  return {
    recoveryCodes: rawRecoveryCodes,
    message: AUTH_MESSAGES.TWO_FACTOR_ENABLED_SUCCESS,
  };
}

// ─── Disable ────────────────────────────────────────────────────────────────────

/**
 * Disables 2FA after verifying the user's password and a valid TOTP code.
 */
export async function disableTwoFactor(
  userId: string,
  password: string,
  code: string,
): Promise<{ message: string }> {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) throw AppError.notFound('User not found');

  if (!user.twoFactorEnabledAt || !user.twoFactorSecret) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_NOT_ENABLED);
  }

  // Verify current password
  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    throw AppError.badRequest(AUTH_MESSAGES.CURRENT_PASSWORD_INCORRECT);
  }

  // Verify TOTP code
  const decryptedSecret = decrypt(user.twoFactorSecret);
  const secret = Secret.fromBase32(decryptedSecret);
  const totp = new TOTP({
    issuer: APP_NAME,
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  await authRepo.disableTwoFactor(userId);
  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);

  return { message: AUTH_MESSAGES.TWO_FACTOR_DISABLED_SUCCESS };
}

// ─── Challenge (Login Flow) ─────────────────────────────────────────────────────

export interface TwoFactorChallengeData {
  twoFactorRequired: true;
  challengeToken: string;
  method: 'totp';
}

/**
 * Creates a 2FA challenge token (Redis-backed, 5min TTL).
 * Called from the login flow when the user has 2FA enabled.
 */
export async function createTwoFactorChallenge(userId: string): Promise<TwoFactorChallengeData> {
  const { rawToken } = await createHashedVerificationToken({
    userId,
    type: 'TWO_FACTOR_CHALLENGE',
    ttlSeconds: TOKEN_EXPIRATION.TWO_FACTOR_CHALLENGE_SECONDS,
  });

  return {
    twoFactorRequired: true,
    challengeToken: rawToken,
    method: 'totp',
  };
}

/**
 * Verifies a 2FA challenge: consumes the challenge token, validates the TOTP
 * code (or recovery code), and issues auth tokens.
 */
export async function verifyTwoFactorChallenge(
  challengeToken: string,
  code: string,
): Promise<{ user: PublicUser } & AuthTokens> {
  // Consume the challenge token
  const record = await verifyAndConsumeHashedToken(challengeToken, 'TWO_FACTOR_CHALLENGE');
  const userId = record.userId;

  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) {
    throw AppError.unauthorized(AUTH_MESSAGES.INVALID_CREDENTIALS);
  }

  if (!user.twoFactorSecret || !user.twoFactorEnabledAt) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_NOT_ENABLED);
  }

  // First try TOTP code validation
  const decryptedSecret = decrypt(user.twoFactorSecret);
  const secret = Secret.fromBase32(decryptedSecret);
  const totp = new TOTP({
    issuer: APP_NAME,
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const delta = totp.validate({ token: code, window: 1 });

  if (delta !== null) {
    // Valid TOTP code — issue tokens
    const publicUser: PublicUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneNumber: user.phoneNumber,
      phoneVerifiedAt: user.phoneVerifiedAt,
      twoFactorEnabledAt: user.twoFactorEnabledAt,
      createdAt: user.createdAt,
    };
    return { user: publicUser, ...(await issueTokens(publicUser)) };
  }

  // If TOTP failed, try recovery codes
  const recoveryCodes = (user.twoFactorRecoveryCodes as string[]) ?? [];
  let matchedIndex = -1;

  for (let i = 0; i < recoveryCodes.length; i++) {
    const matches = await bcrypt.compare(code.toUpperCase(), recoveryCodes[i]!);
    if (matches) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  // Consume the recovery code (remove from array)
  const updatedCodes = [...recoveryCodes];
  updatedCodes.splice(matchedIndex, 1);
  await authRepo.updateRecoveryCodes(userId, updatedCodes);

  const publicUser: PublicUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneNumber: user.phoneNumber,
    phoneVerifiedAt: user.phoneVerifiedAt,
    twoFactorEnabledAt: user.twoFactorEnabledAt,
    createdAt: user.createdAt,
  };
  return { user: publicUser, ...(await issueTokens(publicUser)) };
}

// ─── Status ─────────────────────────────────────────────────────────────────────

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const user = await authRepo.findPublicUserById(userId);
  if (!user) throw AppError.notFound('User not found');

  return {
    enabled: !!user.twoFactorEnabledAt,
    enabledAt: user.twoFactorEnabledAt ?? null,
  };
}
