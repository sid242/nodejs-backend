import { AppError } from '@/lib/errors';

import type {
  CreateAnnouncementDto,
  CreateChangelogDto,
  UpdateAnnouncementDto,
  UpdateChangelogDto,
} from './announcements.dto';
import * as repo from './announcements.repository';

export async function getActiveAnnouncements(context: {
  userId?: string;
  tenantId?: string;
  plan?: string;
  roles?: string[];
}) {
  const announcements = await repo.findActiveAnnouncements();

  let dismissedIds = new Set<string>();
  if (context.userId) {
    const list = await repo.getUserDismissals(context.userId);
    dismissedIds = new Set(list);
  }

  return announcements.filter((ann) => {
    // Check if dismissed
    if (context.userId && dismissedIds.has(ann.id)) {
      return false;
    }

    // Check audience targeting
    if (ann.audience === 'ALL') {
      return true;
    }

    const filter = ann.audienceFilter as string[] | null;
    if (!filter || !Array.isArray(filter) || filter.length === 0) {
      return true;
    }

    if (ann.audience === 'TENANT') {
      return Boolean(context.tenantId && filter.includes(context.tenantId));
    }

    if (ann.audience === 'PLAN') {
      return Boolean(
        context.plan &&
        (filter.includes(context.plan.toLowerCase()) ||
          filter.includes(context.plan.toUpperCase())),
      );
    }

    if (ann.audience === 'ROLE') {
      return Boolean(context.roles?.some((r) => filter.includes(r.toLowerCase())));
    }

    return true;
  });
}

export async function dismissAnnouncement(announcementId: string, userId: string) {
  const announcement = await repo.findAnnouncementById(announcementId);
  if (!announcement) throw AppError.notFound('Announcement not found');
  if (!announcement.dismissible) {
    throw AppError.badRequest('This announcement cannot be dismissed');
  }

  await repo.dismissAnnouncement(announcementId, userId);
  return { success: true };
}

// ─── Platform CRUD ───────────────────────────────────────────────────────────

export async function listAllAnnouncements() {
  return repo.listAllAnnouncements();
}

export async function getAnnouncement(id: string) {
  const ann = await repo.findAnnouncementById(id);
  if (!ann) throw AppError.notFound('Announcement not found');
  return ann;
}

export async function createAnnouncement(dto: CreateAnnouncementDto, staffId?: string) {
  return repo.createAnnouncement({
    title: dto.title,
    body: dto.body,
    severity: dto.severity,
    audience: dto.audience,
    audienceFilter: dto.audienceFilter ?? null,
    startsAt: dto.startsAt ?? new Date(),
    endsAt: dto.endsAt ?? null,
    dismissible: dto.dismissible,
    link: dto.link ?? null,
    status: dto.status,
    createdByStaffId: staffId ?? null,
  });
}

export async function updateAnnouncement(id: string, dto: UpdateAnnouncementDto) {
  const existing = await repo.findAnnouncementById(id);
  if (!existing) throw AppError.notFound('Announcement not found');

  return repo.updateAnnouncement(id, {
    title: dto.title,
    body: dto.body,
    severity: dto.severity,
    audience: dto.audience,
    audienceFilter: dto.audienceFilter,
    startsAt: dto.startsAt,
    endsAt: dto.endsAt,
    dismissible: dto.dismissible,
    link: dto.link,
    status: dto.status,
  });
}

export async function deleteAnnouncement(id: string) {
  const existing = await repo.findAnnouncementById(id);
  if (!existing) throw AppError.notFound('Announcement not found');
  await repo.deleteAnnouncement(id);
  return { success: true };
}

// ─── Changelog Service ───────────────────────────────────────────────────────

export async function listChangelog(page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const result = await repo.listChangelog(limit, offset);
  return {
    items: result.items,
    pagination: {
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    },
  };
}

export async function createChangelog(dto: CreateChangelogDto) {
  return repo.createChangelog({
    version: dto.version,
    title: dto.title,
    body: dto.body,
    tags: dto.tags ?? null,
    publishedAt: dto.publishedAt ?? new Date(),
  });
}

export async function updateChangelog(id: string, dto: UpdateChangelogDto) {
  const updated = await repo.updateChangelog(id, {
    version: dto.version,
    title: dto.title,
    body: dto.body,
    tags: dto.tags,
    publishedAt: dto.publishedAt,
  });
  if (!updated) throw AppError.notFound('Changelog entry not found');
  return updated;
}

export async function deleteChangelog(id: string) {
  const deleted = await repo.deleteChangelog(id);
  if (!deleted) throw AppError.notFound('Changelog entry not found');
  return { success: true };
}
