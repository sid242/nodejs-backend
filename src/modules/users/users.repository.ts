import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/config/db.js';
import { publicUser, users, type PublicUser } from '@/db/schema/index.js';
import type { UpdateMeDto, ListUsersQueryDto } from '@/modules/users/users.dto.js';

export interface PaginatedUsersResult {
  items: PublicUser[];
  total: number;
  page: number;
  limit: number;
}

export async function findById(id: string): Promise<PublicUser | null> {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, id)).limit(1);
  return (user as PublicUser) ?? null;
}

export async function updateById(id: string, data: UpdateMeDto): Promise<PublicUser | null> {
  const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning(publicUser);
  return (user as PublicUser) ?? null;
}

export async function findPaginated({
  page,
  limit,
}: ListUsersQueryDto): Promise<PaginatedUsersResult> {
  const [items, totalResult] = await Promise.all([
    db
      .select(publicUser)
      .from(users)
      .orderBy(desc(users.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
  ]);
  const total = totalResult[0]?.count ?? 0;
  return { items: items as PublicUser[], total, page, limit };
}
