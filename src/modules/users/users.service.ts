import * as userRepo from '@/modules/users/users.repository.js';
import { cache } from '@/lib/cache.js';
import { AppError } from '@/lib/errors.js';
import type { UpdateMeDto, ListUsersQueryDto } from '@/modules/users/users.dto.js';
import type { PublicUser } from '@/db/schema/index.js';

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
