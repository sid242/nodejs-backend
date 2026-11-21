import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { primaryDbHandle } from '@/db/tenancy/context';
import {
  announcements,
  announcementDismissals,
  changelogEntries,
  type Announcement,
  type ChangelogEntry,
  type NewAnnouncement,
  type NewChangelogEntry,
} from '@/db/schema';

export async function findActiveAnnouncements(): Promise<Announcement[]> {
  const db = primaryDbHandle();
  const now = new Date();

  return db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.status, 'LIVE'),
        lte(announcements.startsAt, now),
        or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
      ),
    )
    .orderBy(desc(announcements.startsAt));
}

export async function getUserDismissals(userId: string): Promise<string[]> {
  const db = primaryDbHandle();
  const rows = await db
    .select({ announcementId: announcementDismissals.announcementId })
    .from(announcementDismissals)
    .where(eq(announcementDismissals.userId, userId));
  return rows.map((r) => r.announcementId);
}

export async function dismissAnnouncement(announcementId: string, userId: string): Promise<void> {
  const db = primaryDbHandle();
  await db
    .insert(announcementDismissals)
    .values({ announcementId, userId })
    .onConflictDoNothing();
}

export async function listAllAnnouncements(): Promise<Announcement[]> {
  const db = primaryDbHandle();
  return db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt));
}

export async function findAnnouncementById(id: string): Promise<Announcement | null> {
  const db = primaryDbHandle();
  const [row] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1);
  return row ?? null;
}

export async function createAnnouncement(data: NewAnnouncement): Promise<Announcement> {
  const db = primaryDbHandle();
  const [row] = await db.insert(announcements).values(data).returning();
  if (!row) throw new Error('Failed to create announcement');
  return row;
}

export async function updateAnnouncement(
  id: string,
  data: Partial<NewAnnouncement>,
): Promise<Announcement | null> {
  const db = primaryDbHandle();
  const [row] = await db
    .update(announcements)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(announcements.id, id))
    .returning();
  return row ?? null;
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  const db = primaryDbHandle();
  const result = await db.delete(announcements).where(eq(announcements.id, id)).returning({ id: announcements.id });
  return result.length > 0;
}

// ─── Changelog Repository ────────────────────────────────────────────────────

export async function listChangelog(limit = 20, offset = 0): Promise<{ items: ChangelogEntry[]; total: number }> {
  const db = primaryDbHandle();
  const items = await db
    .select()
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.publishedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(changelogEntries);
  return { items, total: countResult?.count ?? 0 };
}

export async function createChangelog(data: NewChangelogEntry): Promise<ChangelogEntry> {
  const db = primaryDbHandle();
  const [row] = await db.insert(changelogEntries).values(data).returning();
  if (!row) throw new Error('Failed to create changelog entry');
  return row;
}

export async function updateChangelog(
  id: string,
  data: Partial<NewChangelogEntry>,
): Promise<ChangelogEntry | null> {
  const db = primaryDbHandle();
  const [row] = await db
    .update(changelogEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(changelogEntries.id, id))
    .returning();
  return row ?? null;
}

export async function deleteChangelog(id: string): Promise<boolean> {
  const db = primaryDbHandle();
  const result = await db.delete(changelogEntries).where(eq(changelogEntries.id, id)).returning({ id: changelogEntries.id });
  return result.length > 0;
}
