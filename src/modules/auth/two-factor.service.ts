import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Secret, TOTP } from 'otpauth';

import { redis } from '@/config/redis';
import { AUTH_MESSAGES, REDIS_PREFIXES, TOKEN_EXPIRATION } from '@/constants/index';
import type { PublicUser } from '@/db/schema/index';
import { cache } from '@/lib/cache';
import { decrypt, encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import * as authRepo from '@/modules/auth/auth.repository';
import * as sessionsRepo from '@/modules/auth/sessions.repository';
import { issueTokens, type AuthTokens } from '@/modules/auth/tokens';
import * as loginEventsRepo from '@/modules/auth/user-login-events.repository';
import {
  createHashedVerificationToken,
  verifyAndConsumeHashedToken,
} from '@/modules/auth/verification.repository';
import {
  getUserMembershipsWithCanonicalUrls,
  type UserMembershipSummary,
} from '@/modules/tenants/tenant-url.service';

const APP_NAME = 'App';
const RECOVERY_CODE_COUNT = 10;

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

  if (!user.passwordHash) {
    throw AppError.badRequest('Password verification is not available for SSO accounts');
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

export interface TwoFactorClientContext {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
  country?: string;
  city?: string;
}

/**
 * Verifies a 2FA challenge: consumes the challenge token, validates the TOTP
 * code (or recovery code), and issues auth tokens.
 */
export async function verifyTwoFactorChallenge(
  challengeToken: string,
  code: string,
  clientContext?: TwoFactorClientContext,
): Promise<{ user: PublicUser; memberships: UserMembershipSummary[] } & AuthTokens> {
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

  const publicUser: PublicUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneNumber: user.phoneNumber,
    phoneVerifiedAt: user.phoneVerifiedAt,
    twoFactorEnabledAt: user.twoFactorEnabledAt,
    locale: user.locale,
    timezone: user.timezone,
    dateFormat: user.dateFormat,
    lastLoginAt: new Date(),
    createdAt: user.createdAt,
  };

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
    await loginEventsRepo.recordLoginEvent({
      userId: user.id,
      result: 'SUCCESS',
      method: 'PASSWORD',
      ip: clientContext?.ip,
      userAgent: clientContext?.userAgent,
      country: clientContext?.country,
      city: clientContext?.city,
    });
    await authRepo.updateLoginSuccess(user.id);

    const tokens = await issueTokens(publicUser);
    if (tokens.refreshToken) {
      await sessionsRepo.createSessionRecord({
        userId: user.id,
        refreshToken: tokens.refreshToken,
        userAgent: clientContext?.userAgent,
        ipAddress: clientContext?.ip,
        deviceName: clientContext?.deviceName,
        country: clientContext?.country,
        city: clientContext?.city,
        expiresInSeconds: 30 * 24 * 3600,
      });
    }

    const memberships = await getUserMembershipsWithCanonicalUrls(user.id);
    return { user: publicUser, ...tokens, memberships };
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
    await loginEventsRepo.recordLoginEvent({
      userId: user.id,
      result: 'MFA_FAILED',
      method: 'PASSWORD',
      ip: clientContext?.ip,
      userAgent: clientContext?.userAgent,
      country: clientContext?.country,
      city: clientContext?.city,
    });
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  // Consume the recovery code (remove from array)
  const updatedCodes = [...recoveryCodes];
  updatedCodes.splice(matchedIndex, 1);
  await authRepo.updateRecoveryCodes(userId, updatedCodes);

  await loginEventsRepo.recordLoginEvent({
    userId: user.id,
    result: 'SUCCESS',
    method: 'RECOVERY_CODE',
    ip: clientContext?.ip,
    userAgent: clientContext?.userAgent,
    country: clientContext?.country,
    city: clientContext?.city,
  });
  await authRepo.updateLoginSuccess(user.id);

  const tokens = await issueTokens(publicUser);
  if (tokens.refreshToken) {
    await sessionsRepo.createSessionRecord({
      userId: user.id,
      refreshToken: tokens.refreshToken,
      userAgent: clientContext?.userAgent,
      ipAddress: clientContext?.ip,
      deviceName: clientContext?.deviceName,
      country: clientContext?.country,
      city: clientContext?.city,
      expiresInSeconds: 30 * 24 * 3600,
    });
  }

  const memberships = await getUserMembershipsWithCanonicalUrls(user.id);
  return { user: publicUser, ...tokens, memberships };
}

// ─── Status & Recovery Codes ────────────────────────────────────────────────────

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryCodesRemaining: number;
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) throw AppError.notFound('User not found');

  const recoveryCodes = (user.twoFactorRecoveryCodes as string[]) ?? [];

  return {
    enabled: !!user.twoFactorEnabledAt,
    enabledAt: user.twoFactorEnabledAt ?? null,
    recoveryCodesRemaining: recoveryCodes.length,
  };
}

export interface RegenerateRecoveryCodesResult {
  recoveryCodes: string[];
  message: string;
}

/**
 * Regenerates 10 new recovery codes for the user after validating password or 2FA code.
 */
export async function regenerateRecoveryCodes(
  userId: string,
  verification: { password?: string; code?: string },
): Promise<RegenerateRecoveryCodesResult> {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) throw AppError.notFound('User not found');

  if (!user.twoFactorEnabledAt || !user.twoFactorSecret) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_NOT_ENABLED);
  }

  let verified = false;

  // Verify by password if supplied
  if (verification.password && user.passwordHash) {
    const passwordValid = await bcrypt.compare(verification.password, user.passwordHash);
    if (passwordValid) {
      verified = true;
    }
  }

  // Verify by TOTP code if supplied and not yet verified
  if (!verified && verification.code) {
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
    const delta = totp.validate({ token: verification.code, window: 1 });
    if (delta !== null) {
      verified = true;
    }
  }

  if (!verified) {
    throw AppError.badRequest('Invalid password or verification code.');
  }

  // Generate 10 new recovery codes
  const rawRecoveryCodes: string[] = [];
  const hashedRecoveryCodes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const rawCode = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    rawRecoveryCodes.push(rawCode);
    hashedRecoveryCodes.push(await bcrypt.hash(rawCode, 10));
  }

  await authRepo.updateRecoveryCodes(userId, hashedRecoveryCodes);
  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);

  return {
    recoveryCodes: rawRecoveryCodes,
    message: 'New recovery codes generated successfully. Store them in a secure place.',
  };
}
