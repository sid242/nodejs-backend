import { eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { env } from '@/config/env';
import { users, type PublicUser } from '@/db/schema/index';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { createUploadPost, ensurePublicBucketPolicies } from '@/lib/s3';
import { safeFilename } from '@/lib/utils';
import { revokeAllUserTokens } from '@/modules/auth/tokens';
import * as loginEventsRepo from '@/modules/auth/user-login-events.repository';
import {
  createHashedVerificationToken,
  verifyAndConsumeHashedToken,
} from '@/modules/auth/verification.repository';
import * as platformRepo from '@/modules/platform/platform.repository';
import { getUserMembershipsWithCanonicalUrls } from '@/modules/tenants/tenant-url.service';
import type {
  AvatarUploadUrlDto,
  ListLoginHistoryQueryDto,
  ListUsersQueryDto,
  UpdateMeDto,
} from '@/modules/users/users.dto';
import * as userRepo from '@/modules/users/users.repository';
import { emailQueue } from '@/queues/index';

export const getMe = (id: string): Promise<PublicUser> =>
  cache.wrap(`user:${id}`, 300, async () => {
    const user = await userRepo.findById(id);
    if (user) return user;

    // Check if operator is a platform staff member in a support session
    const staff = await platformRepo.findStaffById(id);
    if (staff) {
      return {
        id: staff.id,
        firstName: staff.displayName,
        lastName: null,
        email: staff.email,
        emailVerifiedAt: staff.createdAt,
        role: 'ADMIN',
        status: staff.status,
        phoneNumber: null,
        phoneVerifiedAt: null,
        avatarUrl: null,
        twoFactorEnabledAt: staff.twoFactorEnabledAt,
        locale: 'en',
        timezone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        lastLoginAt: staff.lastLoginAt,
        createdAt: staff.createdAt,
        updatedAt: staff.updatedAt,
      } as PublicUser;
    }

    throw AppError.notFound('User not found');
  });

export async function updateMe(id: string, data: UpdateMeDto): Promise<PublicUser> {
  const updatePayload: Record<string, any> = {};
  if (data?.firstName !== undefined) updatePayload.firstName = data.firstName;
  if (data?.lastName !== undefined) updatePayload.lastName = data.lastName;

  if (data?.avatarUrl !== undefined) updatePayload.avatarUrl = data.avatarUrl;
  if (data?.locale !== undefined) updatePayload.locale = data.locale;
  if (data?.timezone !== undefined) updatePayload.timezone = data.timezone;
  if (data?.dateFormat !== undefined) updatePayload.dateFormat = data.dateFormat;

  if (data?.phoneNumber !== undefined) {
    updatePayload.phoneNumber = data.phoneNumber;
    updatePayload.phoneVerifiedAt = null;
  }
  const user = await userRepo.updateById(id, updatePayload);
  if (!user) throw AppError.notFound('User not found');
  await Promise.all([cache.del(`user:${id}`), cache.delByPrefix('users:list:')]);
  return user;
}

export async function getLoginHistory(
  userId: string,
  query: ListLoginHistoryQueryDto,
): Promise<loginEventsRepo.PaginatedLoginHistoryResult> {
  return loginEventsRepo.findLoginHistoryByUserId(userId, {
    page: query?.page ?? 1,
    limit: query?.limit ?? 20,
  });
}

export const listUsers = ({
  page,
  limit,
}: ListUsersQueryDto): Promise<userRepo.PaginatedUsersResult> =>
  cache.wrap(`users:list:${page}:${limit}`, 30, async () => {
    return userRepo.findPaginated({ page, limit });
  });

export async function getUserById(id: string): Promise<PublicUser> {
  const user = await userRepo.findById(id);
  if (!user) throw AppError.notFound('User not found');
  return user;
}

export async function updateUserStatus(
  targetUserId: string,
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED',
): Promise<PublicUser> {
  const updated = await userRepo.updateStatus(targetUserId, status);
  if (!updated) throw AppError.notFound('User not found');

  // If account is suspended or deactivated, immediately terminate active refresh sessions
  const revocationPromise =
    status === 'SUSPENDED' || status === 'DEACTIVATED'
      ? revokeAllUserTokens(targetUserId)
      : Promise.resolve();

  await Promise.all([
    cache.del(`user:${targetUserId}`),
    cache.delByPrefix('users:list:'),
    revocationPromise,
  ]);
  return updated;
}

export function buildS3PublicUrl(key: string): string {
  if (env.S3_ENDPOINT) {
    const base = env.S3_ENDPOINT.replace(/\/$/, '');
    return `${base}/${env.S3_BUCKET}/${key}`;
  }
  return `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

export async function getAvatarUploadUrl(userId: string, dto: AvatarUploadUrlDto) {
  const user = await userRepo.findById(userId);
  if (!user) throw AppError.notFound('User not found');

  await ensurePublicBucketPolicies();

  const sanitized = safeFilename(dto.filename || 'avatar.png');
  const key = `avatars/${userId}/${Date.now()}-${sanitized}`;

  const upload = await createUploadPost({
    key,
    contentType: dto.contentType,
    expiresIn: 300,
  });

  const publicUrl = buildS3PublicUrl(key);

  return {
    upload,
    fileKey: key,
    publicUrl,
  };
}

export async function getMemberships(userId: string) {
  return getUserMembershipsWithCanonicalUrls(userId);
}

export async function requestEmailChange(userId: string, newEmail: string) {
  const normalizedNewEmail = newEmail.toLowerCase().trim();
  const user = await userRepo.findById(userId);
  if (!user) throw AppError.notFound('User not found');

  if (user.email.toLowerCase() === normalizedNewEmail) {
    throw AppError.badRequest('New email address must be different from current email');
  }

  const existing = await userRepo.findByEmail(normalizedNewEmail);
  if (existing) {
    throw AppError.conflict('An account with this email address already exists');
  }

  await db
    .update(users)
    .set({ pendingEmail: normalizedNewEmail, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const { rawToken } = await createHashedVerificationToken({
    userId,
    type: 'EMAIL_CHANGE',
    target: normalizedNewEmail,
    ttlSeconds: 24 * 3600,
  });

  const exposeDev = Boolean(env.EXPOSE_DEV_TOKENS) && process.env.NODE_ENV !== 'production';

  // Queue email to new address
  await emailQueue.add(
    'verify-email',
    {
      to: normalizedNewEmail,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User',
      token: rawToken,
    },
    { jobId: `email-change-${userId}-${Date.now()}` },
  );

  await cache.del(`user:${userId}`);

  return {
    success: true,
    message: `Verification link sent to ${normalizedNewEmail}. Please confirm to complete email change.`,
    token: exposeDev ? rawToken : undefined,
  };
}

export async function confirmEmailChange(userId: string, token: string) {
  const record = await verifyAndConsumeHashedToken(token, 'EMAIL_CHANGE');
  if (record.userId !== userId) {
    throw AppError.forbidden('Verification token belongs to another account');
  }

  const newEmail = record.target;
  if (!newEmail) {
    throw AppError.badRequest('No pending email address bound to this verification token');
  }

  const existing = await userRepo.findByEmail(newEmail);
  if (existing && existing.id !== userId) {
    throw AppError.conflict('An account with this email address already exists');
  }

  await db
    .update(users)
    .set({
      email: newEmail,
      pendingEmail: null,
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // Revoke all other active sessions for security after sensitive email change
  await revokeAllUserTokens(userId);
  await Promise.all([cache.del(`user:${userId}`), cache.delByPrefix('users:list:')]);

  const updatedUser = await userRepo.findById(userId);
  return {
    success: true,
    message: 'Email address updated successfully',
    user: updatedUser,
  };
}
