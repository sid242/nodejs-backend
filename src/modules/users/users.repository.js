import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { publicUser, users } from '../../db/schema/index.js';

export async function findById(id) {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function updateById(id, data) {
  const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning(publicUser);
  return user ?? null;
}

export async function findPaginated({ page, limit }) {
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
}
