import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Secret, TOTP } from 'otpauth';

import { env } from '@/config/env.js';
import { redis } from '@/config/redis.js';
import {
  AUTH_MESSAGES,
  REDIS_PREFIXES,
  TOKEN_EXPIRATION,
} from '@/constants/index.js';
import { decrypt, encrypt } from '@/lib/crypto.js';
import { AppError } from '@/lib/errors.js';

import * as platformRepo from './platform.repository.js';

const APP_NAME = 'SaaS Platform';
const RECOVERY_CODE_COUNT = 8;
const MAX_CHALLENGE_ATTEMPTS = 5;

export interface PlatformTwoFactorSetupData {
  otpauthUri: string;
  secret: string;
}

export interface PlatformTwoFactorEnableData {
  recoveryCodes: string[];
  message: string;
}

export interface PlatformTwoFactorChallengeData {
  twoFactorRequired: true;
  challengeToken: string;
  method: 'totp';
}

/**
 * Initiates 2FA setup for platform staff member.
 * Generates pending TOTP secret stored in Redis with 10min TTL.
 */
export async function setupPlatformTwoFactor(
  staffId: string,
): Promise<PlatformTwoFactorSetupData> {
  const staff = await platformRepo.findFullStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff not found');

  if (staff.twoFactorEnabledAt) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_ALREADY_ENABLED);
  }

  const secret = new Secret();
  const totp = new TOTP({
    issuer: APP_NAME,
    label: staff.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const redisKey = `${REDIS_PREFIXES.PLATFORM_TWO_FACTOR_PENDING_SECRET}${staffId}`;
  await redis.set(redisKey, secret.base32, 'EX', TOKEN_EXPIRATION.TWO_FACTOR_PENDING_SECONDS);

  return {
    otpauthUri: totp.toString(),
    secret: secret.base32,
  };
}

/**
 * Validates 6-digit TOTP code against pending secret, saves encrypted secret
 * and recovery codes to DB, and activates 2FA on the staff account.
 */
export async function enablePlatformTwoFactor(
  staffId: string,
  code: string,
): Promise<PlatformTwoFactorEnableData> {
  const staff = await platformRepo.findFullStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff not found');

  if (staff.twoFactorEnabledAt) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_ALREADY_ENABLED);
  }

  const redisKey = `${REDIS_PREFIXES.PLATFORM_TWO_FACTOR_PENDING_SECRET}${staffId}`;
  const pendingSecret = await redis.get(redisKey);
  if (!pendingSecret) {
    throw AppError.badRequest(
      'No pending 2FA setup found. Please start the setup process again.',
    );
  }

  const secret = Secret.fromBase32(pendingSecret);
  const totp = new TOTP({
    issuer: APP_NAME,
    label: staff.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  // Generate 8 single-use recovery codes
  const rawRecoveryCodes: string[] = [];
  const hashedRecoveryCodes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const rawCode = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    rawRecoveryCodes.push(rawCode);
    hashedRecoveryCodes.push(await bcrypt.hash(rawCode, 10));
  }

  const encryptedSecret = encrypt(pendingSecret);
  await platformRepo.enablePlatformTwoFactor(staffId, encryptedSecret, hashedRecoveryCodes);
  await redis.del(redisKey);

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
    action: 'platform_staff.2fa_enabled',
    targetType: 'staff',
    targetId: staffId,
    metadata: { method: 'totp' },
  });

  return {
    recoveryCodes: rawRecoveryCodes,
    message: AUTH_MESSAGES.TWO_FACTOR_ENABLED_SUCCESS,
  };
}

/**
 * Disables 2FA on platform staff account after verifying password and 6-digit TOTP code.
 */
export async function disablePlatformTwoFactor(
  staffId: string,
  password: string,
  code: string,
): Promise<{ message: string }> {
  const staff = await platformRepo.findFullStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff not found');

  if (!staff.twoFactorSecret || !staff.twoFactorEnabledAt) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_NOT_ENABLED);
  }

  const validPassword = await bcrypt.compare(password, staff.passwordHash);
  if (!validPassword) {
    throw AppError.unauthorized('Invalid password');
  }

  const decryptedSecret = decrypt(staff.twoFactorSecret);
  const secret = Secret.fromBase32(decryptedSecret);
  const totp = new TOTP({
    issuer: APP_NAME,
    label: staff.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  await platformRepo.disablePlatformTwoFactor(staffId);

  await platformRepo.logPlatformAction({
    actorStaffId: staffId,
    action: 'platform_staff.2fa_disabled',
    targetType: 'staff',
    targetId: staffId,
  });

  return { message: AUTH_MESSAGES.TWO_FACTOR_DISABLED_SUCCESS };
}

/**
 * Gets the current 2FA status for platform staff.
 */
export async function getPlatformTwoFactorStatus(
  staffId: string,
): Promise<{ enabled: boolean; enabledAt: string | null }> {
  const staff = await platformRepo.findStaffById(staffId);
  if (!staff) throw AppError.notFound('Platform staff not found');

  return {
    enabled: Boolean(staff.twoFactorEnabledAt),
    enabledAt: staff.twoFactorEnabledAt ? new Date(staff.twoFactorEnabledAt).toISOString() : null,
  };
}

/**
 * Creates a short-lived Redis-backed challenge token during platform login.
 */
export async function createPlatformTwoFactorChallenge(
  staffId: string,
): Promise<PlatformTwoFactorChallengeData> {
  const challengeToken = randomUUID();
  const redisKey = `${REDIS_PREFIXES.PLATFORM_TWO_FACTOR_CHALLENGE}${challengeToken}`;

  await redis.set(
    redisKey,
    JSON.stringify({ staffId, attempts: 0 }),
    'EX',
    TOKEN_EXPIRATION.TWO_FACTOR_CHALLENGE_SECONDS,
  );

  return {
    twoFactorRequired: true,
    challengeToken,
    method: 'totp',
  };
}

/**
 * Consumes the platform 2FA challenge and issues the platform staff JWT token.
 */
export async function verifyPlatformTwoFactorChallenge(
  challengeToken: string,
  code: string,
  ipAddress?: string,
  userAgent?: string,
  requestId?: string,
) {
  const redisKey = `${REDIS_PREFIXES.PLATFORM_TWO_FACTOR_CHALLENGE}${challengeToken}`;
  const rawData = await redis.get(redisKey);
  if (!rawData) {
    throw AppError.badRequest('Challenge is invalid or has expired. Please log in again.');
  }

  const parsed = JSON.parse(rawData) as { staffId: string; attempts: number };
  if (parsed.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await redis.del(redisKey);
    throw AppError.badRequest('Too many failed verification attempts. Please log in again.');
  }

  const staff = await platformRepo.findFullStaffById(parsed.staffId);
  if (!staff || staff.status !== 'ACTIVE') {
    await redis.del(redisKey);
    throw AppError.unauthorized('Platform staff account is invalid or suspended');
  }

  if (!staff.twoFactorSecret || !staff.twoFactorEnabledAt) {
    await redis.del(redisKey);
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_NOT_ENABLED);
  }

  // Validate TOTP code
  let isValid = false;
  const decryptedSecret = decrypt(staff.twoFactorSecret);
  const secret = Secret.fromBase32(decryptedSecret);
  const totp = new TOTP({
    issuer: APP_NAME,
    label: staff.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const delta = totp.validate({ token: code.trim(), window: 1 });
  if (delta !== null) {
    isValid = true;
  } else if (staff.twoFactorRecoveryCodes && Array.isArray(staff.twoFactorRecoveryCodes)) {
    // Check emergency recovery codes
    const normalizedCode = code.trim().toUpperCase();
    const recoveryList = staff.twoFactorRecoveryCodes;
    let matchedIndex = -1;

    for (let i = 0; i < recoveryList.length; i++) {
      const match = await bcrypt.compare(normalizedCode, recoveryList[i] ?? '');
      if (match) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex !== -1) {
      isValid = true;
      const updatedRecoveryCodes = recoveryList.filter((_, idx) => idx !== matchedIndex);
      await platformRepo.updatePlatformRecoveryCodes(staff.id, updatedRecoveryCodes);
    }
  }

  if (!isValid) {
    parsed.attempts += 1;
    await redis.set(redisKey, JSON.stringify(parsed), 'KEEPTTL');
    throw AppError.badRequest(AUTH_MESSAGES.TWO_FACTOR_INVALID_CODE);
  }

  // Challenge succeeded, delete key
  await redis.del(redisKey);
  await platformRepo.updateStaffLastLogin(staff.id);

  const permissions = await platformRepo.getRolePermissionKeys(staff.roleId);
  const role = await platformRepo.findRoleById(staff.roleId);

  const token = jwt.sign(
    {
      sub: staff.id,
      email: staff.email,
      type: 'PLATFORM_STAFF',
      roleKey: role?.key ?? 'STAFF',
      roleId: staff.roleId,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '8h' },
  );

  await platformRepo.logPlatformAction({
    actorStaffId: staff.id,
    action: 'platform_staff.login_2fa',
    targetType: 'staff',
    targetId: staff.id,
    ipAddress,
    userAgent,
    requestId,
  });

  return {
    token,
    staff: {
      id: staff.id,
      email: staff.email,
      displayName: staff.displayName,
      role: role ? { id: role.id, key: role.key, name: role.name } : null,
      permissions,
      lastLoginAt: staff.lastLoginAt,
      twoFactorEnabled: true,
    },
  };
}
