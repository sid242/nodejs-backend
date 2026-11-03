import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/config/db';
import { GEO_LEVEL, geoEntities } from '@/db/geo';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export interface GeoItem {
  id: number;
  name: string;
  code?: string | null;
  levelId?: number;
}

export async function listStates(): Promise<GeoItem[]> {
  const rows = await db
    .select({
      id: geoEntities.id,
      name: geoEntities.name,
      code: geoEntities.sourceCode,
      levelId: geoEntities.levelId,
    })
    .from(geoEntities)
    .where(and(eq(geoEntities.levelId, GEO_LEVEL.STATE), eq(geoEntities.isActive, true)))
    .orderBy(asc(geoEntities.name));

  return rows?.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    levelId: r.levelId,
  })) ?? [];
}

export async function listChildren(
  parentId: number,
  levelId: number,
  q?: string,
  limit = 2000,
): Promise<GeoItem[]> {
  const rows = await db
    .select({
      id: geoEntities.id,
      name: geoEntities.name,
      code: geoEntities.sourceCode,
      levelId: geoEntities.levelId,
    })
    .from(geoEntities)
    .where(
      and(
        eq(geoEntities.parentId, parentId),
        eq(geoEntities.levelId, levelId),
        eq(geoEntities.isActive, true),
        q ? ilike(geoEntities.name, `${escapeLike(q)}%`) : undefined,
      ),
    )
    .orderBy(asc(geoEntities.name))
    .limit(limit);

  return rows?.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    levelId: r.levelId,
  })) ?? [];
}

export async function findByIds(ids: number[]) {
  if (!ids?.length) return [];
  const rows = await db.select().from(geoEntities).where(inArray(geoEntities.id, ids));
  return rows ?? [];
}

export async function findByPinCode(pin: string) {
  const rows = await db
    .select()
    .from(geoEntities)
    .where(
      and(
        eq(geoEntities.levelId, GEO_LEVEL.AREA),
        or(eq(geoEntities.sourceCode, pin), eq(geoEntities.name, pin)),
        eq(geoEntities.isActive, true),
      ),
    )
    .limit(1);

  return rows?.[0] ?? null;
}

export async function stateIdOf(entityId: number): Promise<number | null> {
  const rows: any = await db.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, level_id FROM geo.geo_entities WHERE id = ${entityId}
      UNION ALL
      SELECT e.id, e.parent_id, e.level_id FROM geo.geo_entities e JOIN up ON e.id = up.parent_id
    )
    SELECT id FROM up WHERE level_id = 2 LIMIT 1`);

  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  const first = list?.[0];
  return first?.id ? Number(first.id) : null;
}

export async function ancestorChainOf(entityId: number): Promise<any[]> {
  const rows: any = await db.execute(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, level_id, name, source_code FROM geo.geo_entities WHERE id = ${entityId}
      UNION ALL
      SELECT e.id, e.parent_id, e.level_id, e.name, e.source_code FROM geo.geo_entities e JOIN up ON e.id = up.parent_id
    )
    SELECT id, parent_id, level_id, name, source_code AS code FROM up ORDER BY level_id ASC`);

  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  return list?.map((item: any) => ({
    id: Number(item.id),
    parentId: item.parent_id ? Number(item.parent_id) : null,
    levelId: Number(item.level_id),
    name: String(item.name),
    code: item.code ? String(item.code) : null,
  })) ?? [];
}

export async function lookupPoint(lat: number, lng: number): Promise<any[]> {
  const rows: any = await db.execute(
    sql`SELECT level, entity_id AS id, name, source_code AS code FROM geo.geo_lookup(${lat}, ${lng})`,
  );
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  return list?.map((item: any) => ({
    level: item.level,
    id: item.id ? Number(item.id) : null,
    name: item.name,
    code: item.code,
  })) ?? [];
}

export const geoRepo = {
  listStates,
  listChildren,
  findByIds,
  findByPinCode,
  stateIdOf,
  ancestorChainOf,
  lookupPoint,
};
