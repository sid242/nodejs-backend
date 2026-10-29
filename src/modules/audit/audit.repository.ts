import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { auditLogs, type AuditLog, type NewAuditLog } from '@/db/schema/index';

export async function createAuditLog(data: NewAuditLog): Promise<AuditLog> {
  const [record] = await db.insert(auditLogs).values(data).returning();
  return record!;
}

export interface AuditLogFilters {
  tenantId?: string;
  userId?: string;
  action?: string;
  actions?: string[];
  search?: string;
  entityType?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
  page?: number;
}

export async function findAuditLogs(filters: AuditLogFilters): Promise<{
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (filters.tenantId) conditions.push(eq(auditLogs.tenantId, filters.tenantId));
  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters.actions && filters.actions.length > 0)
    conditions.push(inArray(auditLogs.action, filters.actions));
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.startDate) conditions.push(gte(auditLogs.createdAt, new Date(filters.startDate)));
  if (filters.endDate) conditions.push(lte(auditLogs.createdAt, new Date(filters.endDate)));

  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(auditLogs.action, term),
        ilike(auditLogs.ipAddress, term),
        ilike(auditLogs.entityType, term),
        ilike(auditLogs.entityId, term),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(whereClause),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  };
}
