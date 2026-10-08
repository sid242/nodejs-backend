import * as userRepo from './users.repository.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';

export const getMe = (id) =>
  cache.wrap(`user:${id}`, 300, async () => {
    const user = await userRepo.findById(id);
    if (!user) throw AppError.notFound('User not found');
    return user;
  });

export async function updateMe(id, data) {
  const user = await userRepo.updateById(id, data);
  if (!user) throw AppError.notFound('User not found');
  await Promise.all([cache.del(`user:${id}`), cache.delByPrefix('users:list:')]);
  return user;
}

export const listUsers = ({ page, limit }) =>
  cache.wrap(`users:list:${page}:${limit}`, 30, async () => {
    return userRepo.findPaginated({ page, limit });
  });
