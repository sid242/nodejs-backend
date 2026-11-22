import type { SearchItem, SearchQueryDto, SearchResult } from './search.dto';
import * as repo from './search.repository';

const STATIC_PAGES: SearchItem[] = [
  {
    id: 'page-dashboard',
    title: 'Dashboard',
    subtitle: 'Overview metrics, summary, and recent activity',
    category: 'Pages',
    href: '/dashboard',
    icon: 'dashboard',
  },
  {
    id: 'page-team',
    title: 'Team Members',
    subtitle: 'Manage team users, invitations, and access',
    category: 'Pages',
    href: '/team',
    icon: 'user',
  },
  {
    id: 'page-roles',
    title: 'Roles & Permissions',
    subtitle: 'Configure dynamic RBAC roles and permissions',
    category: 'Pages',
    href: '/roles',
    icon: 'shield',
  },
  {
    id: 'page-groups',
    title: 'User Groups',
    subtitle: 'Organize members into functional access groups',
    category: 'Pages',
    href: '/groups',
    icon: 'users',
  },
  {
    id: 'page-files',
    title: 'Files & Storage',
    subtitle: 'Browse uploaded documents, assets, and files',
    category: 'Pages',
    href: '/files',
    icon: 'file',
  },
  {
    id: 'page-templates',
    title: 'Email Templates',
    subtitle: 'Transactional and branded email templates',
    category: 'Pages',
    href: '/email-templates',
    icon: 'mail',
  },
  {
    id: 'page-audit-logs',
    title: 'Audit Logs',
    subtitle: 'Security events, user actions, and compliance stream',
    category: 'Pages',
    href: '/audit-logs',
    icon: 'scroll',
  },
  {
    id: 'page-branding',
    title: 'White-Label Branding',
    subtitle: 'Customize company logo, theme colors, and custom domain',
    category: 'Pages',
    href: '/settings/branding',
    icon: 'palette',
  },
  {
    id: 'page-smtp',
    title: 'SMTP Configuration',
    subtitle: 'Custom mail server settings and delivery testing',
    category: 'Pages',
    href: '/settings/email',
    icon: 'mail',
  },
  {
    id: 'page-settings',
    title: 'Workspace Settings',
    subtitle: 'General workspace configuration, timezone, and locale',
    category: 'Pages',
    href: '/settings',
    icon: 'settings',
  },
  {
    id: 'page-security',
    title: 'Security Policies',
    subtitle: 'MFA requirements, IP allowlists, and session rules',
    category: 'Pages',
    href: '/settings/security',
    icon: 'lock',
  },
  {
    id: 'page-billing',
    title: 'Billing & Plans',
    subtitle: 'Subscription plan, seat limits, and invoice history',
    category: 'Pages',
    href: '/billing',
    icon: 'credit-card',
  },
];

const STATIC_ACTIONS: SearchItem[] = [
  {
    id: 'action-invite-member',
    title: 'Invite Team Member',
    subtitle: 'Send email invitation to join this workspace',
    category: 'Actions',
    href: '/team?action=invite',
    icon: 'user-plus',
  },
  {
    id: 'action-upload-file',
    title: 'Upload File',
    subtitle: 'Upload a document, PDF, or image asset',
    category: 'Actions',
    href: '/files?action=upload',
    icon: 'upload',
  },
  {
    id: 'action-create-role',
    title: 'Create Custom Role',
    subtitle: 'Define granular permissions for workspace members',
    category: 'Actions',
    href: '/roles?action=create',
    icon: 'shield-plus',
  },
  {
    id: 'action-create-group',
    title: 'Create User Group',
    subtitle: 'Group members together for bulk authorization',
    category: 'Actions',
    href: '/groups?action=create',
    icon: 'users-plus',
  },
  {
    id: 'action-update-branding',
    title: 'Update Brand Assets',
    subtitle: 'Upload new logo or change primary color',
    category: 'Actions',
    href: '/settings/branding',
    icon: 'palette',
  },
];

export async function globalSearch(
  query: SearchQueryDto,
  tenantId?: string | null,
  userPermissions: string[] = [],
  extraPages: SearchItem[] = [],
): Promise<SearchResult> {
  const q = query.q.trim().toLowerCase();
  const limit = query.limit ?? 20;
  const types = query.types;

  const results: SearchItem[] = [];
  const can = (permission: string) =>
    userPermissions.includes('*') || userPermissions.includes(permission);
  const pagePermissions: Record<string, string> = {
    'page-team': 'members:read',
    'page-roles': 'roles:read',
    'page-groups': 'groups:read',
    'page-files': 'files:read',
    'page-templates': 'email_templates:read',
    'page-audit-logs': 'audit:read',
    'page-branding': 'tenants:read',
    'page-smtp': 'tenants:update',
    'page-settings': 'tenants:read',
    'page-security': 'tenants:update',
    'page-billing': 'billing:read',
  };
  const actionPermissions: Record<string, string> = {
    'action-invite-member': 'members:invite',
    'action-upload-file': 'files:write',
    'action-create-role': 'roles:create',
    'action-create-group': 'groups:create',
    'action-update-branding': 'tenants:update',
  };

  // 1. Pages matching query
  if (!types || types.includes('pages')) {
    const matchingPages = [...STATIC_PAGES, ...extraPages].filter((p) => {
      const permission = pagePermissions[p.id];
      return (
        (!permission || can(permission)) &&
        (p.title.toLowerCase().includes(q) || p.subtitle?.toLowerCase().includes(q))
      );
    });
    results.push(...matchingPages);
  }

  // 2. Actions matching query
  if (!types || types.includes('actions')) {
    const matchingActions = STATIC_ACTIONS.filter((a) => {
      const permission = actionPermissions[a.id];
      return (
        Boolean(permission && can(permission)) &&
        (a.title.toLowerCase().includes(q) || a.subtitle?.toLowerCase().includes(q))
      );
    });
    results.push(...matchingActions);
  }

  // 3. Dynamic tenant database entity searches
  if (tenantId) {
    const perCategoryLimit = Math.max(3, Math.floor(limit / 3));

    const promises: Promise<SearchItem[]>[] = [];

    // Members search
    if (can('members:read') && (!types || types.includes('members'))) {
      promises.push(repo.searchMembers(tenantId, q, perCategoryLimit).catch(() => []));
    }

    // Files search
    if (can('files:read') && (!types || types.includes('files'))) {
      promises.push(repo.searchFiles(tenantId, q, perCategoryLimit).catch(() => []));
    }

    // Roles search
    if (can('roles:read') && (!types || types.includes('roles'))) {
      promises.push(repo.searchRoles(tenantId, q, perCategoryLimit).catch(() => []));
    }

    // Groups search
    if (can('groups:read') && (!types || types.includes('groups'))) {
      promises.push(repo.searchGroups(tenantId, q, perCategoryLimit).catch(() => []));
    }

    // Templates search
    if (can('email_templates:read') && (!types || types.includes('templates'))) {
      promises.push(repo.searchEmailTemplates(tenantId, q, perCategoryLimit).catch(() => []));
    }

    const dynamicResults = await Promise.all(promises);
    for (const group of dynamicResults) {
      results.push(...group);
    }
  }

  // Cap total results at requested limit
  const capped = results.slice(0, limit);

  return {
    query: query.q,
    total: capped.length,
    results: capped,
  };
}
