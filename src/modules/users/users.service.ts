import type { PublicUser } from '@/db/schema/index.js';
import { cache } from '@/lib/cache.js';
import { AppError } from '@/lib/errors.js';
import { revokeAllUserTokens } from '@/modules/auth/tokens.js';
import type { ListUsersQueryDto, UpdateMeDto } from '@/modules/users/users.dto.js';
import * as userRepo from '@/modules/users/users.repository.js';

export const getMe = (id: string): Promise<PublicUser> =>
  cache.wrap(`user:${id}`, 300, async () => {
    const user = await userRepo.findById(id);
    if (!user) throw AppError.notFound('User not found');
    return user;
  });

export async function updateMe(id: string, data: UpdateMeDto): Promise<PublicUser> {
  const user = await userRepo.updateById(id, data);
  if (!user) throw AppError.notFound('User not found');
  await Promise.all([cache.del(`user:${id}`), cache.delByPrefix('users:list:')]);
  return user;
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

export async function updateUserRole(
  targetUserId: string,
  role: 'USER' | 'ADMIN',
): Promise<PublicUser> {
  const updated = await userRepo.updateRole(targetUserId, role);
  if (!updated) throw AppError.notFound('User not found');

  // Invalidate cache and revoke active refresh tokens so next refresh cycle issues updated role claim
  await Promise.all([
    cache.del(`user:${targetUserId}`),
    cache.delByPrefix('users:list:'),
    revokeAllUserTokens(targetUserId),
  ]);
  return updated;
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
