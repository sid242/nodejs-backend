import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { userLoginEvents, type NewUserLoginEvent, type UserLoginEvent } from '@/db/schema/index';

export interface RecordLoginEventParams {
  userId?: string | null;
  tenantId?: string | null;
  result: 'SUCCESS' | 'FAILED' | 'LOCKED' | 'MFA_FAILED';
  method: 'PASSWORD' | 'MAGIC' | 'SSO' | 'HANDOFF' | 'RECOVERY_CODE';
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  city?: string | null;
}

export async function recordLoginEvent(params: RecordLoginEventParams): Promise<UserLoginEvent> {
  const [event] = await db
    .insert(userLoginEvents)
    .values({
      userId: params.userId ?? null,
      tenantId: params.tenantId ?? null,
      result: params.result,
      method: params.method,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      country: params.country ?? null,
      city: params.city ?? null,
    })
    .returning();

  return event!;
}

export interface PaginatedLoginHistoryResult {
  items: UserLoginEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function findLoginHistoryByUserId(
  userId: string,
  { page = 1, limit = 20 }: { page?: number; limit?: number },
): Promise<PaginatedLoginHistoryResult> {
  const offset = (page - 1) * limit;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(userLoginEvents)
      .where(eq(userLoginEvents.userId, userId))
      .orderBy(desc(userLoginEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userLoginEvents)
      .where(eq(userLoginEvents.userId, userId)),
  ]);

  const total = Number(totalResult[0]?.count ?? 0);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
