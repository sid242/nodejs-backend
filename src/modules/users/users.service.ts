import type { PublicUser } from '@/db/schema/index';
import { cache } from '@/lib/cache';
import { AppError } from '@/lib/errors';
import { revokeAllUserTokens } from '@/modules/auth/tokens';
import * as loginEventsRepo from '@/modules/auth/user-login-events.repository';
import * as platformRepo from '@/modules/platform/platform.repository';
import type { ListLoginHistoryQueryDto, ListUsersQueryDto, UpdateMeDto } from '@/modules/users/users.dto';
import * as userRepo from '@/modules/users/users.repository';

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
