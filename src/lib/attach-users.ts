import { inArray } from 'drizzle-orm';

import { users } from '@/db/schema/index';
import { primaryDbHandle } from '@/db/tenancy/context';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: string;
}

/**
 * Enriches a collection of tenant-scoped records with user profiles from the primary database cluster.
 * Decouples tenant databases from the central identity database, avoiding invalid cross-database SQL joins.
 */
export async function attachUsers<T extends Record<string, any>>(
  records: T[],
  userIdKey: keyof T = 'userId' as keyof T,
  outputKey = 'user',
): Promise<(T & Record<string, any>)[]> {
  if (!records || records.length === 0) return [];

  const rawIds: unknown[] = records.map((r) => r[userIdKey]);
  const userIds = [
    ...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ];

  if (userIds.length === 0) {
    return records.map((r) => ({ ...r, [outputKey]: null }));
  }

  const primaryDb = primaryDbHandle();
  const userRows = await primaryDb
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      status: users.status,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  const userMap = new Map(userRows.map((u) => [u.id, u]));

  return records.map((r) => {
    const id = r[userIdKey];
    const u = id ? (userMap.get(id as string) ?? null) : null;
    return {
      ...r,
      [outputKey]: u,
    };
  });
}
