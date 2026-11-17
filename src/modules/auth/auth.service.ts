import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { AUTH_MESSAGES, REDIS_PREFIXES } from '@/constants/index';
import type { PublicUser, User } from '@/db/schema';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/modules/audit/audit.service';
import type {
  ChangePasswordDto,
  CreateHandoffDto,
  ForgotPasswordDto,
  LoginDto,
  RedeemHandoffDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '@/modules/auth/auth.dto';
import * as authRepo from '@/modules/auth/auth.repository';
import { assertSsoNotEnforced } from '@/modules/sso/sso.enforcement';
import {
  consumeRefreshToken,
  createEmailVerificationToken,
  createMagicLinkToken,
  createPasswordResetToken,
  issueImpersonationToken,
  issueTokens,
  revokeAllUserTokens,
  verifyAndConsumeEmailVerificationToken,
  verifyAndConsumeMagicLinkToken,
  verifyAndConsumePasswordResetToken,
  type AuthTokens,
} from '@/modules/auth/tokens';
import {
  createTwoFactorChallenge,
  type TwoFactorChallengeData,
} from '@/modules/auth/two-factor.service';
import { rbacRepo } from '@/modules/rbac/rbac.repository';
import {
  buildPlatformUrl,
  buildTenantUrl,
  getEffectiveUrlMode,
  getUserMembershipsWithCanonicalUrls,
  type UserMembershipSummary,
} from '@/modules/tenants/tenant-url.service';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';
import { emailQueue } from '@/queues/index';

// Compared against when the user doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);

export { getUserMembershipsWithCanonicalUrls, type UserMembershipSummary };

export interface AuthResult extends AuthTokens {
  user: PublicUser;
  memberships: UserMembershipSummary[];
}

export async function register({ email, password, name }: RegisterDto): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await authRepo.createUser({ email, passwordHash, name });
  await cache.delByPrefix(REDIS_PREFIXES.USERS_LIST_CACHE);

  // Slow/unreliable work goes to the queue, not the request path. jobId makes it idempotent.
  const verificationToken = await createEmailVerificationToken(user.id);
  await Promise.all([
    emailQueue.add('welcome', { to: user.email, name: user.name }, { jobId: `welcome-${user.id}` }),
    emailQueue.add(
      'verify-email',
      { to: user.email, name: user.name, token: verificationToken },
      { jobId: `verify-email-${user.id}-${Date.now()}` },
    ),
  ]);

  const memberships = await getUserMembershipsWithCanonicalUrls(user.id);
  return { user, ...(await issueTokens(user)), memberships };
}

export async function login({
  email,
  password,
}: LoginDto): Promise<AuthResult | TwoFactorChallengeData> {
  const record = await authRepo.findByEmail(email);

  // If user account is managed without password (e.g. SCIM/SSO provisioned)
  if (record && !record.passwordHash) {
    await assertSsoNotEnforced({ email: record.email, userId: record.id });
    throw AppError.unauthorized('Account is managed via Single Sign-On. Please sign in with SSO.');
  }

  const ok = await bcrypt.compare(password, record?.passwordHash ?? DUMMY_HASH);
  if (!record || !record.passwordHash || !ok || record.deletedAt)
    throw AppError.unauthorized(AUTH_MESSAGES.INVALID_CREDENTIALS);

  if (record.status === 'SUSPENDED' || record.status === 'DEACTIVATED') {
    throw AppError.forbidden(`Account is ${record.status.toLowerCase()}`);
  }

  // Mandatory SSO enforcement check (allows break-glass for OWNER accounts with ssoBypass: true)
  await assertSsoNotEnforced({ email: record.email, userId: record.id });

  if (!record.emailVerifiedAt) {
    throw AppError.forbidden(AUTH_MESSAGES.EMAIL_NOT_VERIFIED, {
      email: record.email,
      emailVerified: false,
    });
  }

  // If 2FA is enabled, return a challenge instead of tokens
  if (record.twoFactorEnabledAt) {
    return createTwoFactorChallenge(record.id);
  }

  const user: PublicUser = {
    id: record.id,
    email: record.email,
    name: record.name,
    status: record.status,
    emailVerifiedAt: record.emailVerifiedAt,
    phoneNumber: record.phoneNumber,
    phoneVerifiedAt: record.phoneVerifiedAt,
    twoFactorEnabledAt: record.twoFactorEnabledAt,
    createdAt: record.createdAt,
  };
  const memberships = await getUserMembershipsWithCanonicalUrls(record.id);
  return { user, ...(await issueTokens(user)), memberships };
}

export async function refresh(
  refreshToken: string,
): Promise<AuthTokens & { memberships: UserMembershipSummary[] }> {
  const userId = await consumeRefreshToken(refreshToken);
  const user = await authRepo.findPublicUserById(userId);
  if (!user) throw AppError.unauthorized();
  if (!user.emailVerifiedAt) {
    throw AppError.forbidden(AUTH_MESSAGES.EMAIL_NOT_VERIFIED, {
      email: user.email,
      emailVerified: false,
    });
  }

  const tokens = await issueTokens(user);
  const memberships = await getUserMembershipsWithCanonicalUrls(user.id);
  return { ...tokens, memberships };
}

export async function forgotPassword({ email }: ForgotPasswordDto): Promise<{ message: string }> {
  const record = await authRepo.findByEmail(email);

  if (record) {
    const token = await createPasswordResetToken(record.id);
    await emailQueue.add(
      'password-reset',
      { to: record.email, name: record.name, token },
      { jobId: `pwd-reset-${record.id}-${Date.now()}` },
    );
  }

  return { message: AUTH_MESSAGES.PASSWORD_RESET_SENT };
}

export async function resetPassword({
  token,
  password,
}: ResetPasswordDto): Promise<{ message: string }> {
  const userId = await verifyAndConsumePasswordResetToken(token);
  const existingUser = await authRepo.findById(userId);
  if (existingUser) {
    await assertSsoNotEnforced({ email: existingUser.email, userId: existingUser.id });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await authRepo.updatePassword(userId, passwordHash);
  if (!user) throw AppError.notFound('User not found');

  await Promise.all([
    revokeAllUserTokens(userId),
    cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`),
  ]);

  return { message: AUTH_MESSAGES.PASSWORD_RESET_SUCCESS };
}

export async function changePassword(
  userId: string,
  { currentPassword, newPassword }: ChangePasswordDto,
): Promise<{ message: string }> {
  const user = await authRepo.findById(userId);
  if (!user || user.deletedAt) {
    throw AppError.notFound('User not found');
  }

  if (!user.passwordHash) {
    throw AppError.badRequest('Password changes are not permitted for SSO-managed accounts');
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw AppError.badRequest(AUTH_MESSAGES.CURRENT_PASSWORD_INCORRECT);
  }

  const isSame = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSame) {
    throw AppError.badRequest(AUTH_MESSAGES.NEW_PASSWORD_SAME);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await authRepo.updatePassword(userId, passwordHash);

  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);

  return { message: AUTH_MESSAGES.PASSWORD_CHANGED_SUCCESS };
}

export async function requestEmailVerification(identifier: {
  userId?: string;
  email?: string;
}): Promise<{ message: string }> {
  let user: User | null = null;
  if (identifier.userId) {
    user = await authRepo.findById(identifier.userId);
  } else if (identifier.email) {
    user = await authRepo.findByEmail(identifier.email);
  }

  // Prevent email enumeration: return generic message if user not found
  if (!user) {
    return { message: AUTH_MESSAGES.VERIFICATION_EMAIL_SENT };
  }

  if (user.emailVerifiedAt) {
    if (identifier.userId) {
      throw AppError.badRequest(AUTH_MESSAGES.EMAIL_ALREADY_VERIFIED);
    }
    return { message: AUTH_MESSAGES.VERIFICATION_EMAIL_SENT };
  }

  const token = await createEmailVerificationToken(user.id);
  await emailQueue.add(
    'verify-email',
    { to: user.email, name: user.name, token },
    { jobId: `verify-email-${user.id}-${Date.now()}` },
  );

  return { message: AUTH_MESSAGES.VERIFICATION_EMAIL_SENT };
}

export async function verifyEmail({
  token,
}: VerifyEmailDto): Promise<{ user: PublicUser; message: string }> {
  const userId = await verifyAndConsumeEmailVerificationToken(token);
  const user = await authRepo.markEmailVerified(userId);

  if (!user) throw AppError.notFound('User not found');
  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);

  return { user, message: AUTH_MESSAGES.EMAIL_VERIFIED_SUCCESS };
}

export interface MagicLinkRequestResult {
  message: string;
  email: string;
  expiresInMinutes: number;
  token?: string;
  magicLinkUrl?: string;
}

export async function requestMagicLink(email: string): Promise<MagicLinkRequestResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await authRepo.findByEmail(normalizedEmail);

  if (user) {
    await assertSsoNotEnforced({ email: normalizedEmail, userId: user.id });
  } else {
    await assertSsoNotEnforced({ email: normalizedEmail });
  }

  const genericMessage =
    'If an account exists with this email, a magic sign-in link has been sent.';

  if (!user || user.deletedAt || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    return {
      message: genericMessage,
      email: normalizedEmail,
      expiresInMinutes: 15,
    };
  }

  const rawToken = await createMagicLinkToken(user.id);
  const userTenants = await tenantsRepo.findUserTenants(user.id);
  let magicLinkUrl: string;
  if (userTenants.length === 1 && userTenants[0]?.id) {
    magicLinkUrl = await buildTenantUrl(userTenants[0].id, `/magic-link?token=${rawToken}`);
  } else {
    magicLinkUrl = buildPlatformUrl(`/magic-link?token=${rawToken}`);
  }

  await emailQueue.add(
    'magic-link',
    {
      to: user.email,
      name: user.name,
      token: rawToken,
      magicLinkUrl,
    },
    { jobId: `magic-link-${user.id}-${Date.now()}` },
  );

  const exposeDev = Boolean(env.EXPOSE_DEV_TOKENS) && process.env.NODE_ENV !== 'production';

  return {
    message: genericMessage,
    email: user.email,
    expiresInMinutes: 15,
    token: exposeDev ? rawToken : undefined,
    magicLinkUrl: exposeDev ? magicLinkUrl : undefined,
  };
}

export async function verifyMagicLink(token: string): Promise<AuthResult> {
  const { userId } = await verifyAndConsumeMagicLinkToken(token);
  const userRecord = await authRepo.findById(userId);
  if (!userRecord || userRecord.deletedAt) {
    throw AppError.unauthorized('User account not found');
  }

  // Mandatory SSO enforcement check
  await assertSsoNotEnforced({ email: userRecord.email, userId: userRecord.id });

  if (userRecord.status === 'SUSPENDED' || userRecord.status === 'DEACTIVATED') {
    throw AppError.forbidden(`Account is ${userRecord.status.toLowerCase()}`);
  }

  let finalUser: PublicUser | null = null;
  // If user was PENDING_VERIFICATION or unverified, mark as ACTIVE and emailVerifiedAt
  if (!userRecord.emailVerifiedAt || userRecord.status === 'PENDING_VERIFICATION') {
    finalUser = await authRepo.markEmailVerified(userRecord.id);
  }

  if (!finalUser) {
    finalUser = await authRepo.findPublicUserById(userRecord.id);
  }

  if (!finalUser) {
    throw AppError.internal('Failed to retrieve user status');
  }

  await cache.del(`${REDIS_PREFIXES.USER_CACHE}${userId}`);
  const memberships = await getUserMembershipsWithCanonicalUrls(finalUser.id);
  return { user: finalUser, ...(await issueTokens(finalUser, 'MAGIC_LINK')), memberships };
}

/**
 * Atomically retrieves and deletes a key from Redis, supporting both native GETDEL and Lua fallback.
 */
async function atomicGetDel(redisClient: any, key: string): Promise<string | null> {
  if (typeof redisClient?.getdel === 'function') {
    try {
      return (await redisClient.getdel(key)) ?? null;
    } catch {
      /* fallback to Lua */
    }
  }
  return (await redisClient?.eval?.(
    "local v = redis.call('get', KEYS[1]); if v then redis.call('del', KEYS[1]); end; return v;",
    1,
    key,
  )) as string | null;
}

export async function createHandoff(
  userId: string,
  { tenantId, targetHost }: CreateHandoffDto,
  authMethod = 'SSO',
): Promise<{ handoffUrl: string; code: string }> {
  const member = await tenantsRepo.findTenantMember(tenantId, userId);
  if (!member || member?.status !== 'ACTIVE') {
    throw AppError.forbidden('You are not an active member of this workspace');
  }

  const canonicalBase = await buildTenantUrl(tenantId, '');
  const normalizedTargetHost = targetHost?.trim()?.toLowerCase()?.split(':')?.[0] ?? '';
  let canonicalHost = '';
  try {
    canonicalHost = new URL(canonicalBase)?.host?.toLowerCase()?.split(':')?.[0] ?? '';
  } catch {
    canonicalHost = '';
  }
  const platformHost = env?.PLATFORM_HOST?.toLowerCase()?.split(':')?.[0] ?? '';

  if (normalizedTargetHost !== canonicalHost && normalizedTargetHost !== platformHost) {
    throw AppError.badRequest('Target host must match the tenant canonical host or platform host');
  }

  const code = crypto.randomBytes(32).toString('hex');
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  await redis?.set?.(
    `handoff:${codeHash}`,
    JSON.stringify({ userId, tenantId, targetHost: normalizedTargetHost, authMethod }),
    'EX',
    60,
  );

  await logSecurityEvent({
    userId,
    tenantId,
    action: 'AUTH_HANDOFF_ISSUED',
    entityType: 'handoff',
    entityId: codeHash,
    metadata: { targetHost: normalizedTargetHost, authMethod },
  });

  const protocol = normalizedTargetHost?.includes('localhost') ? 'http' : 'https';
  const handoffUrl = `${protocol}://${targetHost}/api/auth/handoff?code=${code}`;

  return { handoffUrl, code };
}

export async function redeemHandoff({
  code,
  host,
}: RedeemHandoffDto): Promise<AuthResult & { tenantId: string }> {
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const key = `handoff:${codeHash}`;

  const raw = await atomicGetDel(redis, key);
  if (!raw) {
    throw AppError.unauthorized('Handoff code is invalid or has expired', {
      code: 'HANDOFF_EXPIRED',
    });
  }

  const payload = JSON.parse(raw) as {
    userId?: string;
    tenantId?: string;
    targetHost?: string;
    authMethod?: string;
  };
  const normalizedHost = host?.trim()?.toLowerCase()?.split(':')?.[0] ?? '';

  if (!payload?.targetHost || payload.targetHost !== normalizedHost) {
    throw AppError.unauthorized('Handoff target host mismatch', { code: 'HANDOFF_HOST_MISMATCH' });
  }

  if (!payload?.userId || !payload?.tenantId) {
    throw AppError.unauthorized('Invalid handoff payload');
  }

  const userRecord = await authRepo.findById(payload.userId);
  if (!userRecord || userRecord?.deletedAt) {
    throw AppError.unauthorized('User not found');
  }

  if (userRecord?.status === 'SUSPENDED' || userRecord?.status === 'DEACTIVATED') {
    throw AppError.forbidden(`Account is ${userRecord.status.toLowerCase()}`);
  }

  const user: PublicUser = {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    status: userRecord.status,
    emailVerifiedAt: userRecord.emailVerifiedAt,
    phoneNumber: userRecord.phoneNumber,
    phoneVerifiedAt: userRecord.phoneVerifiedAt,
    twoFactorEnabledAt: userRecord.twoFactorEnabledAt,
    createdAt: userRecord.createdAt,
  };

  const tokens = await issueTokens(user, payload.authMethod ?? 'SSO');
  const memberships = await getUserMembershipsWithCanonicalUrls(user.id);

  await logSecurityEvent({
    userId: user.id,
    tenantId: payload.tenantId,
    action: 'AUTH_HANDOFF_REDEEMED',
    entityType: 'handoff',
    entityId: codeHash,
    metadata: { host: normalizedHost },
  });

  return {
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    memberships,
    tenantId: payload.tenantId,
  };
}

export async function impersonateUser({
  caller,
  targetUserId,
  reason,
  durationMinutes = 30,
}: {
  caller: { id: string; type: 'USER' | 'STAFF'; email?: string };
  targetUserId: string;
  reason: string;
  durationMinutes?: number;
}): Promise<{
  accessToken: string;
  sessionId: string;
  expiresInSeconds: number;
  expiresInMinutes: number;
  targetUser: { id: string; name: string; email: string };
}> {
  if (caller.id === targetUserId) {
    throw AppError.badRequest('Cannot impersonate yourself');
  }

  const targetUserRecord = await authRepo.findById(targetUserId);
  if (!targetUserRecord || targetUserRecord.deletedAt) {
    throw AppError.notFound('Target user not found');
  }

  if (targetUserRecord.status === 'SUSPENDED' || targetUserRecord.status === 'DEACTIVATED') {
    throw AppError.forbidden(
      `Cannot impersonate an account that is ${targetUserRecord.status.toLowerCase()}`,
    );
  }

  if (caller.type === 'USER') {
    const callerMemberships = await tenantsRepo.findMembershipsByUserId(caller.id);
    const targetMemberships = await tenantsRepo.findMembershipsByUserId(targetUserId);

    const sharedTenantIds = callerMemberships
      .filter((cm: { status: string; tenantId: string }) => cm.status === 'ACTIVE')
      .map((cm: { tenantId: string }) => cm.tenantId)
      .filter((tid: string) =>
        targetMemberships.some(
          (tm: { tenantId: string; status: string }) =>
            tm.tenantId === tid && tm.status === 'ACTIVE',
        ),
      );

    if (sharedTenantIds.length === 0) {
      throw AppError.forbidden('Cannot impersonate a user outside of your organizations');
    }

    let hasImpersonateAccess = false;

    for (const tenantId of sharedTenantIds) {
      const callerPerms = await rbacRepo.getEffectivePermissions(tenantId, caller.id);
      const isCallerOwnerOrAdmin =
        callerPerms.roles.includes('OWNER') ||
        callerPerms.roles.includes('ADMIN') ||
        callerPerms.permissions.includes('users:impersonate');

      if (isCallerOwnerOrAdmin) {
        const targetPerms = await rbacRepo.getEffectivePermissions(tenantId, targetUserId);
        const targetIsOwner = targetPerms.roles.includes('OWNER');
        const callerIsOwner = callerPerms.roles.includes('OWNER');

        if (!targetIsOwner || callerIsOwner) {
          hasImpersonateAccess = true;
          break;
        }
      }
    }

    if (!hasImpersonateAccess) {
      throw AppError.forbidden('Insufficient permissions to impersonate users in this workspace');
    }
  }

  const sessionId = crypto.randomUUID();
  const ttlSeconds = Math.max(60, Math.floor(durationMinutes * 60));

  await redis.set(
    `auth:impersonation:${sessionId}`,
    JSON.stringify({
      sessionId,
      targetUserId,
      impersonatorId: caller.id,
      impersonatorType: caller.type,
      reason,
      durationMinutes,
      createdAt: new Date().toISOString(),
    }),
    'EX',
    ttlSeconds,
  );

  const { accessToken, expiresInSeconds } = issueImpersonationToken(
    { id: targetUserRecord.id },
    caller,
    durationMinutes,
    sessionId,
  );

  await logSecurityEvent({
    userId: targetUserRecord.id,
    action: 'IMPERSONATION_STARTED',
    entityType: 'user',
    entityId: targetUserRecord.id,
    metadata: {
      impersonatorId: caller.id,
      impersonatorType: caller.type,
      sessionId,
      reason,
      durationMinutes,
    },
  });

  return {
    accessToken,
    sessionId,
    expiresInSeconds,
    expiresInMinutes: durationMinutes,
    targetUser: {
      id: targetUserRecord.id,
      name: targetUserRecord.name,
      email: targetUserRecord.email,
    },
  };
}

export async function stopImpersonation({
  sessionId,
  impersonatorId,
  targetUserId,
}: {
  sessionId?: string;
  impersonatorId?: string;
  targetUserId?: string;
}): Promise<{ message: string }> {
  if (sessionId) {
    await redis.del(`auth:impersonation:${sessionId}`);
  }

  if (targetUserId) {
    await logSecurityEvent({
      userId: targetUserId,
      action: 'IMPERSONATION_STOPPED',
      entityType: 'user',
      entityId: targetUserId,
      metadata: {
        sessionId,
        impersonatorId,
      },
    });
  }

  return { message: 'Impersonation session stopped successfully' };
}
