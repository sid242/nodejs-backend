import { and, eq, ilike, isNull, or } from 'drizzle-orm';

import { emailTemplates, files, roles, tenantMembers, userGroups, users } from '@/db/schema/index';
import { tenantDb } from '@/db/tenancy/context';

import type { SearchItem } from './search.dto';

export async function searchMembers(
  tenantId: string,
  query: string,
  limit = 5,
): Promise<SearchItem[]> {
  const pattern = `%${query}%`;

  const rows = await tenantDb()
    .select({
      id: tenantMembers.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      jobTitle: tenantMembers.jobTitle,
      department: tenantMembers.department,
      status: tenantMembers.status,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          ilike(users.email, pattern),
          ilike(tenantMembers.jobTitle, pattern),
          ilike(tenantMembers.department, pattern),
        ),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: `member-${r.id}`,
    title: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email,
    subtitle: [r.jobTitle, r.department, r.email].filter(Boolean).join(' · '),
    category: 'Members',
    href: `/team?search=${encodeURIComponent(r.email)}`,
    icon: 'user',
    metadata: {
      userId: r.userId,
      memberId: r.id,
      status: r.status,
    },
  }));
}

export async function searchFiles(
  tenantId: string,
  query: string,
  limit = 5,
): Promise<SearchItem[]> {
  const pattern = `%${query}%`;

  const rows = await tenantDb()
    .select({
      id: files.id,
      filename: files.filename,
      contentType: files.contentType,
      size: files.size,
    })
    .from(files)
    .where(
      and(
        eq(files.tenantId, tenantId),
        eq(files.status, 'UPLOADED'),
        ilike(files.filename, pattern),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: `file-${r.id}`,
    title: r.filename,
    subtitle: `${r.contentType} · ${r.size ? `${Math.round(r.size / 1024)} KB` : ''}`,
    category: 'Files',
    href: `/files?search=${encodeURIComponent(r.filename)}`,
    icon: 'file',
    metadata: {
      fileId: r.id,
      contentType: r.contentType,
    },
  }));
}

export async function searchRoles(
  tenantId: string,
  query: string,
  limit = 5,
): Promise<SearchItem[]> {
  const pattern = `%${query}%`;

  const rows = await tenantDb()
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(
      and(
        or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)),
        or(ilike(roles.name, pattern), ilike(roles.description, pattern)),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: `role-${r.id}`,
    title: r.name,
    subtitle: r.description ?? (r.isSystem ? 'System built-in role' : 'Custom workspace role'),
    category: 'Roles',
    href: `/roles`,
    icon: 'shield',
    metadata: {
      roleId: r.id,
      isSystem: r.isSystem,
    },
  }));
}

export async function searchGroups(
  tenantId: string,
  query: string,
  limit = 5,
): Promise<SearchItem[]> {
  const pattern = `%${query}%`;

  const rows = await tenantDb()
    .select({
      id: userGroups.id,
      name: userGroups.name,
      description: userGroups.description,
    })
    .from(userGroups)
    .where(
      and(
        eq(userGroups.tenantId, tenantId),
        or(ilike(userGroups.name, pattern), ilike(userGroups.description, pattern)),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: `group-${r.id}`,
    title: r.name,
    subtitle: r.description ?? 'Workspace User Group',
    category: 'Groups',
    href: `/groups`,
    icon: 'users',
    metadata: {
      groupId: r.id,
    },
  }));
}

export async function searchEmailTemplates(
  tenantId: string,
  query: string,
  limit = 5,
): Promise<SearchItem[]> {
  const pattern = `%${query}%`;

  const rows = await tenantDb()
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      slug: emailTemplates.slug,
      subject: emailTemplates.subject,
    })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.tenantId, tenantId),
        or(
          ilike(emailTemplates.name, pattern),
          ilike(emailTemplates.slug, pattern),
          ilike(emailTemplates.subject, pattern),
        ),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: `template-${r.id}`,
    title: r.name,
    subtitle: r.subject ? `Subject: ${r.subject}` : `Slug: ${r.slug}`,
    category: 'Templates',
    href: `/email-templates`,
    icon: 'mail',
    metadata: {
      templateId: r.id,
      slug: r.slug,
    },
  }));
}
