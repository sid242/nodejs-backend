import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { publicUser, users } from '../../db/schema/index.js';
import { cache } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';

export const getMe = (id) =>
  cache.wrap(`user:${id}`, 300, async () => {
    const [user] = await db.select(publicUser).from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw AppError.notFound('User not found');
    return user;
  });

export async function updateMe(id, data) {
  const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning(publicUser);
  await Promise.all([cache.del(`user:${id}`), cache.delByPrefix('users:list:')]);
  return user;
}

export const listUsers = ({ page, limit }) =>
  cache.wrap(`users:list:${page}:${limit}`, 30, async () => {
    const [items, total] = await Promise.all([
      db
        .select(publicUser)
        .from(users)
        .orderBy(desc(users.createdAt))
        .offset((page - 1) * limit)
        .limit(limit),
      db.select({ count: sql`count(*)::int` }).from(users),
    ]);
    return { items, total: total[0].count, page, limit };
  });
