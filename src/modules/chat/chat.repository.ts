import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import { redis } from '@/config/redis';
import {
  chatChannelMembers,
  chatChannels,
  chatMessageAttachments,
  chatMessageMentions,
  chatMessageReactions,
  chatMessages,
  platformChatChannelMembers,
  platformChatChannels,
  platformChatMessageAttachments,
  platformChatMessageMentions,
  platformChatMessageReactions,
  platformChatMessages,
  platformRoles,
  platformStaff,
  tenantMembers,
  users,
  type ChatAttachmentMetadata,
} from '@/db/schema/index';
import { assertTenantScope, primaryDbHandle, tenantDb } from '@/db/tenancy/context';

import type {
  ChatChannelType,
  ChatContext,
  ChatMessageType,
  ChatParticipantProfile,
  ChatParticipantRole,
  ChatReactionSummary,
  ChatScope,
} from './chat.types';

export interface RawChannel {
  id: string;
  tenantId: string | null;
  type: ChatChannelType;
  name: string | null;
  slug: string | null;
  description: string | null;
  topic: string | null;
  directKey: string | null;
  createdByActorId: string;
  isArchived: boolean;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RawMember {
  id: string;
  channelId: string;
  actorId: string;
  role: ChatParticipantRole;
  isMuted: boolean;
  isPinned: boolean;
  lastReadAt: Date | null;
  lastReadMessageId: string | null;
  unreadCount: number;
  joinedAt: Date;
  leftAt: Date | null;
  updatedAt: Date;
}

export interface RawMessage {
  id: string;
  channelId: string;
  senderId: string;
  type: ChatMessageType;
  body: string;
  parentMessageId: string | null;
  replyCount: number;
  isPinned: boolean;
  pinnedByActorId: string | null;
  pinnedAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedByActorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RawReaction {
  id: string;
  channelId: string;
  messageId: string;
  actorId: string;
  emoji: string;
  createdAt: Date;
}

const PRESENCE_TTL_SECONDS = 90;

export function presenceKey(scope: ChatScope, scopeId: string, actorId: string): string {
  return `chat:presence:${scope}:${scopeId}:${actorId}`;
}

export async function setActorPresence(
  scope: ChatScope,
  scopeId: string,
  actorId: string,
  online: boolean,
): Promise<void> {
  try {
    const key = presenceKey(scope, scopeId, actorId);
    if (online) {
      await redis.set(key, '1', 'EX', PRESENCE_TTL_SECONDS);
    } else {
      await redis.del(key);
    }
  } catch {
    /* presence is best-effort */
  }
}

export async function getOnlineActorSet(
  scope: ChatScope,
  scopeId: string,
  actorIds: string[],
): Promise<Set<string>> {
  const uniqueIds = Array.from(new Set(actorIds));
  if (uniqueIds.length === 0) return new Set();
  try {
    const keys = uniqueIds.map((id) => presenceKey(scope, scopeId, id));
    const values = await redis.mget(...keys);
    const online = new Set<string>();
    values.forEach((val, idx) => {
      const actorId = uniqueIds[idx];
      if (val && actorId) online.add(actorId);
    });
    return online;
  } catch {
    return new Set();
  }
}

function getScopeDb(ctx: ChatContext) {
  if (ctx.scope === 'tenant') {
    assertTenantScope(ctx.tenantId);
    return tenantDb();
  }
  return primaryDbHandle();
}

function mapTenantChannel(row: typeof chatChannels.$inferSelect): RawChannel {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    name: row.name,
    slug: row.slug,
    description: row.description,
    topic: row.topic,
    directKey: row.directKey,
    createdByActorId: row.createdByUserId,
    isArchived: row.isArchived,
    archivedAt: row.archivedAt,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageSenderId: row.lastMessageSenderId,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPlatformChannel(row: typeof platformChatChannels.$inferSelect): RawChannel {
  return {
    id: row.id,
    tenantId: null,
    type: row.type,
    name: row.name,
    slug: row.slug,
    description: row.description,
    topic: row.topic,
    directKey: row.directKey,
    createdByActorId: row.createdByStaffId,
    isArchived: row.isArchived,
    archivedAt: row.archivedAt,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageSenderId: row.lastMessageSenderId,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTenantMember(row: typeof chatChannelMembers.$inferSelect): RawMember {
  return {
    id: row.id,
    channelId: row.channelId,
    actorId: row.userId,
    role: row.role,
    isMuted: row.isMuted,
    isPinned: row.isPinned,
    lastReadAt: row.lastReadAt,
    lastReadMessageId: row.lastReadMessageId,
    unreadCount: row.unreadCount,
    joinedAt: row.joinedAt,
    leftAt: row.leftAt,
    updatedAt: row.updatedAt,
  };
}

function mapPlatformMember(row: typeof platformChatChannelMembers.$inferSelect): RawMember {
  return {
    id: row.id,
    channelId: row.channelId,
    actorId: row.staffId,
    role: row.role,
    isMuted: row.isMuted,
    isPinned: row.isPinned,
    lastReadAt: row.lastReadAt,
    lastReadMessageId: row.lastReadMessageId,
    unreadCount: row.unreadCount,
    joinedAt: row.joinedAt,
    leftAt: row.leftAt,
    updatedAt: row.updatedAt,
  };
}

function mapTenantMessage(row: typeof chatMessages.$inferSelect): RawMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    senderId: row.senderId,
    type: row.type,
    body: row.body,
    parentMessageId: row.parentMessageId,
    replyCount: row.replyCount,
    isPinned: row.isPinned,
    pinnedByActorId: row.pinnedByUserId,
    pinnedAt: row.pinnedAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    deletedByActorId: row.deletedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPlatformMessage(row: typeof platformChatMessages.$inferSelect): RawMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    senderId: row.senderId,
    type: row.type,
    body: row.body,
    parentMessageId: row.parentMessageId,
    replyCount: row.replyCount,
    isPinned: row.isPinned,
    pinnedByActorId: row.pinnedByStaffId,
    pinnedAt: row.pinnedAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    deletedByActorId: row.deletedByStaffId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTenantReaction(row: typeof chatMessageReactions.$inferSelect): RawReaction {
  return {
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId,
    actorId: row.userId,
    emoji: row.emoji,
    createdAt: row.createdAt,
  };
}

function mapPlatformReaction(row: typeof platformChatMessageReactions.$inferSelect): RawReaction {
  return {
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId,
    actorId: row.staffId,
    emoji: row.emoji,
    createdAt: row.createdAt,
  };
}

export async function hydrateProfiles(
  scope: ChatScope,
  tenantId: string | null,
  actorIds: string[],
): Promise<Map<string, ChatParticipantProfile>> {
  const uniqueIds = Array.from(new Set(actorIds));
  const map = new Map<string, ChatParticipantProfile>();
  if (uniqueIds.length === 0) return map;

  const pDb = primaryDbHandle();
  const scopeId = scope === 'tenant' ? (tenantId ?? '') : 'platform';
  const onlineSet = await getOnlineActorSet(scope, scopeId, uniqueIds);

  if (scope === 'tenant' && tenantId) {
    const rows = await pDb
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        jobTitle: tenantMembers.jobTitle,
      })
      .from(users)
      .leftJoin(
        tenantMembers,
        and(eq(tenantMembers.userId, users.id), eq(tenantMembers.tenantId, tenantId)),
      )
      .where(inArray(users.id, uniqueIds));

    for (const r of rows) {
      const fullName = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim();
      map.set(r.id, {
        id: r.id,
        displayName: fullName || r.email,
        email: r.email,
        avatarUrl: r.avatarUrl ?? null,
        roleLabel: r.jobTitle ?? null,
        isOnline: onlineSet.has(r.id),
      });
    }
  } else {
    const rows = await pDb
      .select({
        id: platformStaff.id,
        displayName: platformStaff.displayName,
        email: platformStaff.email,
        avatarUrl: platformStaff.avatarUrl,
        roleName: platformRoles.name,
      })
      .from(platformStaff)
      .leftJoin(platformRoles, eq(platformStaff.roleId, platformRoles.id))
      .where(inArray(platformStaff.id, uniqueIds));

    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        displayName: r.displayName || r.email,
        email: r.email,
        avatarUrl: r.avatarUrl ?? null,
        roleLabel: r.roleName ?? null,
        isOnline: onlineSet.has(r.id),
      });
    }
  }

  return map;
}

export async function listActiveContacts(
  ctx: ChatContext,
  q?: string,
): Promise<ChatParticipantProfile[]> {
  const pDb = primaryDbHandle();
  const term = q?.trim();
  const scopeId = ctx.scope === 'tenant' ? ctx.tenantId : 'platform';

  if (ctx.scope === 'tenant') {
    const rows = await pDb
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        jobTitle: tenantMembers.jobTitle,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(tenantMembers.userId, users.id))
      .where(
        and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.status, 'ACTIVE'),
          isNull(users.deletedAt),
          term
            ? or(
                ilike(users.firstName, `%${term}%`),
                ilike(users.lastName, `%${term}%`),
                ilike(users.email, `%${term}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(users.firstName), asc(users.email))
      .limit(100);

    const onlineSet = await getOnlineActorSet(
      'tenant',
      scopeId,
      rows.map((r) => r.id),
    );

    return rows.map((r) => {
      const fullName = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim();
      return {
        id: r.id,
        displayName: fullName || r.email,
        email: r.email,
        avatarUrl: r.avatarUrl ?? null,
        roleLabel: r.jobTitle ?? null,
        isOnline: onlineSet.has(r.id),
      };
    });
  }

  const rows = await pDb
    .select({
      id: platformStaff.id,
      displayName: platformStaff.displayName,
      email: platformStaff.email,
      avatarUrl: platformStaff.avatarUrl,
      roleName: platformRoles.name,
    })
    .from(platformStaff)
    .leftJoin(platformRoles, eq(platformStaff.roleId, platformRoles.id))
    .where(
      and(
        eq(platformStaff.status, 'ACTIVE'),
        term
          ? or(
              ilike(platformStaff.displayName, `%${term}%`),
              ilike(platformStaff.email, `%${term}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(platformStaff.displayName), asc(platformStaff.email))
    .limit(100);

  const onlineSet = await getOnlineActorSet(
    'platform',
    scopeId,
    rows.map((r) => r.id),
  );

  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName || r.email,
    email: r.email,
    avatarUrl: r.avatarUrl ?? null,
    roleLabel: r.roleName ?? null,
    isOnline: onlineSet.has(r.id),
  }));
}

export async function verifyActiveActors(ctx: ChatContext, actorIds: string[]): Promise<string[]> {
  const uniqueIds = Array.from(new Set(actorIds));
  if (uniqueIds.length === 0) return [];
  const pDb = primaryDbHandle();

  if (ctx.scope === 'tenant') {
    const rows = await pDb
      .select({ id: tenantMembers.userId })
      .from(tenantMembers)
      .innerJoin(users, eq(tenantMembers.userId, users.id))
      .where(
        and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.status, 'ACTIVE'),
          isNull(users.deletedAt),
          inArray(tenantMembers.userId, uniqueIds),
        ),
      );
    return rows.map((r) => r.id);
  }

  const rows = await pDb
    .select({ id: platformStaff.id })
    .from(platformStaff)
    .where(and(eq(platformStaff.status, 'ACTIVE'), inArray(platformStaff.id, uniqueIds)));
  return rows.map((r) => r.id);
}

export async function findChannelById(
  ctx: ChatContext,
  channelId: string,
): Promise<RawChannel | null> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const [row] = await dbHandle
      .select()
      .from(chatChannels)
      .where(and(eq(chatChannels.tenantId, ctx.tenantId), eq(chatChannels.id, channelId)))
      .limit(1);
    return row ? mapTenantChannel(row) : null;
  }
  const [row] = await dbHandle
    .select()
    .from(platformChatChannels)
    .where(eq(platformChatChannels.id, channelId))
    .limit(1);
  return row ? mapPlatformChannel(row) : null;
}

export async function findChannelBySlug(
  ctx: ChatContext,
  slug: string,
): Promise<RawChannel | null> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const [row] = await dbHandle
      .select()
      .from(chatChannels)
      .where(and(eq(chatChannels.tenantId, ctx.tenantId), eq(chatChannels.slug, slug)))
      .limit(1);
    return row ? mapTenantChannel(row) : null;
  }
  const [row] = await dbHandle
    .select()
    .from(platformChatChannels)
    .where(eq(platformChatChannels.slug, slug))
    .limit(1);
  return row ? mapPlatformChannel(row) : null;
}

export async function findDirectChannelByKey(
  ctx: ChatContext,
  directKey: string,
): Promise<RawChannel | null> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const [row] = await dbHandle
      .select()
      .from(chatChannels)
      .where(and(eq(chatChannels.tenantId, ctx.tenantId), eq(chatChannels.directKey, directKey)))
      .limit(1);
    return row ? mapTenantChannel(row) : null;
  }
  const [row] = await dbHandle
    .select()
    .from(platformChatChannels)
    .where(eq(platformChatChannels.directKey, directKey))
    .limit(1);
  return row ? mapPlatformChannel(row) : null;
}

export async function findMember(
  ctx: ChatContext,
  channelId: string,
  actorId: string,
): Promise<RawMember | null> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const [row] = await dbHandle
      .select()
      .from(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, actorId),
          isNull(chatChannelMembers.leftAt),
        ),
      )
      .limit(1);
    return row ? mapTenantMember(row) : null;
  }
  const [row] = await dbHandle
    .select()
    .from(platformChatChannelMembers)
    .where(
      and(
        eq(platformChatChannelMembers.channelId, channelId),
        eq(platformChatChannelMembers.staffId, actorId),
        isNull(platformChatChannelMembers.leftAt),
      ),
    )
    .limit(1);
  return row ? mapPlatformMember(row) : null;
}

export async function filterActiveChannelMembers(
  ctx: ChatContext,
  channelId: string,
  actorIds: string[],
): Promise<string[]> {
  const uniqueIds = Array.from(new Set(actorIds));
  if (uniqueIds.length === 0) return [];
  const dbHandle = getScopeDb(ctx);

  if (ctx.scope === 'tenant') {
    const rows = await dbHandle
      .select({ actorId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.channelId, channelId),
          inArray(chatChannelMembers.userId, uniqueIds),
          isNull(chatChannelMembers.leftAt),
        ),
      );
    return rows.map((r) => r.actorId);
  }

  const rows = await dbHandle
    .select({ actorId: platformChatChannelMembers.staffId })
    .from(platformChatChannelMembers)
    .where(
      and(
        eq(platformChatChannelMembers.channelId, channelId),
        inArray(platformChatChannelMembers.staffId, uniqueIds),
        isNull(platformChatChannelMembers.leftAt),
      ),
    );
  return rows.map((r) => r.actorId);
}

export async function listChannelMembers(
  ctx: ChatContext,
  channelId: string,
): Promise<RawMember[]> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const rows = await dbHandle
      .select()
      .from(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.channelId, channelId),
          isNull(chatChannelMembers.leftAt),
        ),
      )
      .orderBy(asc(chatChannelMembers.joinedAt));
    return rows.map(mapTenantMember);
  }
  const rows = await dbHandle
    .select()
    .from(platformChatChannelMembers)
    .where(
      and(
        eq(platformChatChannelMembers.channelId, channelId),
        isNull(platformChatChannelMembers.leftAt),
      ),
    )
    .orderBy(asc(platformChatChannelMembers.joinedAt));
  return rows.map(mapPlatformMember);
}

export async function listVisibleChannels(
  ctx: ChatContext,
  opts: { includeArchived: boolean; type?: ChatChannelType; q?: string },
): Promise<{
  channels: RawChannel[];
  myMemberships: Map<string, RawMember>;
  memberCounts: Map<string, number>;
  directMembersMap: Map<string, string[]>;
}> {
  const dbHandle = getScopeDb(ctx);
  const term = opts.q?.trim();

  if (ctx.scope === 'tenant') {
    const myRows = await dbHandle
      .select()
      .from(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.userId, ctx.actorId),
          isNull(chatChannelMembers.leftAt),
        ),
      );
    const myMemberships = new Map(myRows.map((m) => [m.channelId, mapTenantMember(m)]));
    const joinedIds = myRows.map((m) => m.channelId);

    const visibilityCond =
      joinedIds.length > 0
        ? or(eq(chatChannels.type, 'PUBLIC'), inArray(chatChannels.id, joinedIds))
        : eq(chatChannels.type, 'PUBLIC');

    const channelRows = await dbHandle
      .select()
      .from(chatChannels)
      .where(
        and(
          eq(chatChannels.tenantId, ctx.tenantId),
          visibilityCond,
          opts.includeArchived ? undefined : eq(chatChannels.isArchived, false),
          opts.type ? eq(chatChannels.type, opts.type) : undefined,
          term
            ? or(ilike(chatChannels.name, `%${term}%`), ilike(chatChannels.topic, `%${term}%`))
            : undefined,
        ),
      )
      .orderBy(desc(chatChannels.lastMessageAt), desc(chatChannels.createdAt));

    const channels = channelRows.map(mapTenantChannel);
    const channelIds = channels.map((c) => c.id);
    const memberCounts = new Map<string, number>();
    const directMembersMap = new Map<string, string[]>();

    if (channelIds.length > 0) {
      const counts = await dbHandle
        .select({
          channelId: chatChannelMembers.channelId,
          count: sql<number>`count(*)::int`,
        })
        .from(chatChannelMembers)
        .where(
          and(
            eq(chatChannelMembers.tenantId, ctx.tenantId),
            inArray(chatChannelMembers.channelId, channelIds),
            isNull(chatChannelMembers.leftAt),
          ),
        )
        .groupBy(chatChannelMembers.channelId);
      for (const c of counts) memberCounts.set(c.channelId, c.count);

      const directIds = channels.filter((c) => c.type === 'DIRECT').map((c) => c.id);
      if (directIds.length > 0) {
        const dMembers = await dbHandle
          .select({
            channelId: chatChannelMembers.channelId,
            actorId: chatChannelMembers.userId,
          })
          .from(chatChannelMembers)
          .where(
            and(
              eq(chatChannelMembers.tenantId, ctx.tenantId),
              inArray(chatChannelMembers.channelId, directIds),
              isNull(chatChannelMembers.leftAt),
            ),
          );
        for (const dm of dMembers) {
          const list = directMembersMap.get(dm.channelId) ?? [];
          list.push(dm.actorId);
          directMembersMap.set(dm.channelId, list);
        }
      }
    }

    return { channels, myMemberships, memberCounts, directMembersMap };
  }

  const myRows = await dbHandle
    .select()
    .from(platformChatChannelMembers)
    .where(
      and(
        eq(platformChatChannelMembers.staffId, ctx.actorId),
        isNull(platformChatChannelMembers.leftAt),
      ),
    );
  const myMemberships = new Map(myRows.map((m) => [m.channelId, mapPlatformMember(m)]));
  const joinedIds = myRows.map((m) => m.channelId);

  const visibilityCond =
    joinedIds.length > 0
      ? or(eq(platformChatChannels.type, 'PUBLIC'), inArray(platformChatChannels.id, joinedIds))
      : eq(platformChatChannels.type, 'PUBLIC');

  const channelRows = await dbHandle
    .select()
    .from(platformChatChannels)
    .where(
      and(
        visibilityCond,
        opts.includeArchived ? undefined : eq(platformChatChannels.isArchived, false),
        opts.type ? eq(platformChatChannels.type, opts.type) : undefined,
        term
          ? or(
              ilike(platformChatChannels.name, `%${term}%`),
              ilike(platformChatChannels.topic, `%${term}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(platformChatChannels.lastMessageAt), desc(platformChatChannels.createdAt));

  const channels = channelRows.map(mapPlatformChannel);
  const channelIds = channels.map((c) => c.id);
  const memberCounts = new Map<string, number>();
  const directMembersMap = new Map<string, string[]>();

  if (channelIds.length > 0) {
    const counts = await dbHandle
      .select({
        channelId: platformChatChannelMembers.channelId,
        count: sql<number>`count(*)::int`,
      })
      .from(platformChatChannelMembers)
      .where(
        and(
          inArray(platformChatChannelMembers.channelId, channelIds),
          isNull(platformChatChannelMembers.leftAt),
        ),
      )
      .groupBy(platformChatChannelMembers.channelId);
    for (const c of counts) memberCounts.set(c.channelId, c.count);

    const directIds = channels.filter((c) => c.type === 'DIRECT').map((c) => c.id);
    if (directIds.length > 0) {
      const dMembers = await dbHandle
        .select({
          channelId: platformChatChannelMembers.channelId,
          actorId: platformChatChannelMembers.staffId,
        })
        .from(platformChatChannelMembers)
        .where(
          and(
            inArray(platformChatChannelMembers.channelId, directIds),
            isNull(platformChatChannelMembers.leftAt),
          ),
        );
      for (const dm of dMembers) {
        const list = directMembersMap.get(dm.channelId) ?? [];
        list.push(dm.actorId);
        directMembersMap.set(dm.channelId, list);
      }
    }
  }

  return { channels, myMemberships, memberCounts, directMembersMap };
}

export async function createChannelWithMembers(
  ctx: ChatContext,
  data: {
    type: ChatChannelType;
    name: string | null;
    slug: string | null;
    description: string | null;
    topic: string | null;
    directKey: string | null;
  },
  members: Array<{ actorId: string; role: ChatParticipantRole }>,
): Promise<RawChannel> {
  const dbHandle = getScopeDb(ctx);

  return dbHandle.transaction(async (tx) => {
    if (ctx.scope === 'tenant') {
      const [created] = await tx
        .insert(chatChannels)
        .values({
          tenantId: ctx.tenantId,
          type: data.type,
          name: data.name,
          slug: data.slug,
          description: data.description,
          topic: data.topic,
          directKey: data.directKey,
          createdByUserId: ctx.actorId,
        })
        .returning();

      if (created && members.length > 0) {
        await tx
          .insert(chatChannelMembers)
          .values(
            members.map((m) => ({
              tenantId: ctx.tenantId,
              channelId: created.id,
              userId: m.actorId,
              role: m.role,
            })),
          )
          .onConflictDoNothing();
      }
      return mapTenantChannel(created!);
    }

    const [created] = await tx
      .insert(platformChatChannels)
      .values({
        type: data.type,
        name: data.name,
        slug: data.slug,
        description: data.description,
        topic: data.topic,
        directKey: data.directKey,
        createdByStaffId: ctx.actorId,
      })
      .returning();

    if (created && members.length > 0) {
      await tx
        .insert(platformChatChannelMembers)
        .values(
          members.map((m) => ({
            channelId: created.id,
            staffId: m.actorId,
            role: m.role,
          })),
        )
        .onConflictDoNothing();
    }
    return mapPlatformChannel(created!);
  });
}

export async function updateChannel(
  ctx: ChatContext,
  channelId: string,
  data: {
    name?: string;
    description?: string | null;
    topic?: string | null;
    isArchived?: boolean;
    archivedAt?: Date | null;
  },
): Promise<RawChannel | null> {
  const dbHandle = getScopeDb(ctx);
  const patch = {
    ...data,
    updatedAt: new Date(),
  };

  if (ctx.scope === 'tenant') {
    const [updated] = await dbHandle
      .update(chatChannels)
      .set(patch)
      .where(and(eq(chatChannels.tenantId, ctx.tenantId), eq(chatChannels.id, channelId)))
      .returning();
    return updated ? mapTenantChannel(updated) : null;
  }

  const [updated] = await dbHandle
    .update(platformChatChannels)
    .set(patch)
    .where(eq(platformChatChannels.id, channelId))
    .returning();
  return updated ? mapPlatformChannel(updated) : null;
}

export async function addMembers(
  ctx: ChatContext,
  channelId: string,
  membersToAdd: Array<{ actorId: string; role: ChatParticipantRole }>,
): Promise<void> {
  if (membersToAdd.length === 0) return;
  const dbHandle = getScopeDb(ctx);
  const now = new Date();
  const actorIds = membersToAdd.map((m) => m.actorId);

  await dbHandle.transaction(async (tx) => {
    if (ctx.scope === 'tenant') {
      // Reactivate soft-departed memberships rather than inserting duplicates
      await tx
        .update(chatChannelMembers)
        .set({ leftAt: null, joinedAt: now, unreadCount: 0, updatedAt: now })
        .where(
          and(
            eq(chatChannelMembers.tenantId, ctx.tenantId),
            eq(chatChannelMembers.channelId, channelId),
            inArray(chatChannelMembers.userId, actorIds),
            isNotNull(chatChannelMembers.leftAt),
          ),
        );

      await tx
        .insert(chatChannelMembers)
        .values(
          membersToAdd.map((m) => ({
            tenantId: ctx.tenantId,
            channelId,
            userId: m.actorId,
            role: m.role,
          })),
        )
        .onConflictDoNothing();
      return;
    }

    await tx
      .update(platformChatChannelMembers)
      .set({ leftAt: null, joinedAt: now, unreadCount: 0, updatedAt: now })
      .where(
        and(
          eq(platformChatChannelMembers.channelId, channelId),
          inArray(platformChatChannelMembers.staffId, actorIds),
          isNotNull(platformChatChannelMembers.leftAt),
        ),
      );

    await tx
      .insert(platformChatChannelMembers)
      .values(
        membersToAdd.map((m) => ({
          channelId,
          staffId: m.actorId,
          role: m.role,
        })),
      )
      .onConflictDoNothing();
  });
}

export async function removeMember(
  ctx: ChatContext,
  channelId: string,
  actorId: string,
): Promise<void> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();
  if (ctx.scope === 'tenant') {
    await dbHandle
      .update(chatChannelMembers)
      .set({ leftAt: now, updatedAt: now })
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, actorId),
          isNull(chatChannelMembers.leftAt),
        ),
      );
    return;
  }
  await dbHandle
    .update(platformChatChannelMembers)
    .set({ leftAt: now, updatedAt: now })
    .where(
      and(
        eq(platformChatChannelMembers.channelId, channelId),
        eq(platformChatChannelMembers.staffId, actorId),
        isNull(platformChatChannelMembers.leftAt),
      ),
    );
}

export async function updateMemberRole(
  ctx: ChatContext,
  channelId: string,
  actorId: string,
  role: ChatParticipantRole,
): Promise<RawMember | null> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();
  if (ctx.scope === 'tenant') {
    const [updated] = await dbHandle
      .update(chatChannelMembers)
      .set({ role, updatedAt: now })
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, actorId),
          isNull(chatChannelMembers.leftAt),
        ),
      )
      .returning();
    return updated ? mapTenantMember(updated) : null;
  }
  const [updated] = await dbHandle
    .update(platformChatChannelMembers)
    .set({ role, updatedAt: now })
    .where(
      and(
        eq(platformChatChannelMembers.channelId, channelId),
        eq(platformChatChannelMembers.staffId, actorId),
        isNull(platformChatChannelMembers.leftAt),
      ),
    )
    .returning();
  return updated ? mapPlatformMember(updated) : null;
}

export async function updateMemberPreferences(
  ctx: ChatContext,
  channelId: string,
  actorId: string,
  prefs: { isMuted?: boolean; isPinned?: boolean },
): Promise<RawMember | null> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();
  if (ctx.scope === 'tenant') {
    const [updated] = await dbHandle
      .update(chatChannelMembers)
      .set({ ...prefs, updatedAt: now })
      .where(
        and(
          eq(chatChannelMembers.tenantId, ctx.tenantId),
          eq(chatChannelMembers.channelId, channelId),
          eq(chatChannelMembers.userId, actorId),
          isNull(chatChannelMembers.leftAt),
        ),
      )
      .returning();
    return updated ? mapTenantMember(updated) : null;
  }
  const [updated] = await dbHandle
    .update(platformChatChannelMembers)
    .set({ ...prefs, updatedAt: now })
    .where(
      and(
        eq(platformChatChannelMembers.channelId, channelId),
        eq(platformChatChannelMembers.staffId, actorId),
        isNull(platformChatChannelMembers.leftAt),
      ),
    )
    .returning();
  return updated ? mapPlatformMember(updated) : null;
}

export async function findMessageById(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
): Promise<RawMessage | null> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const [row] = await dbHandle
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.tenantId, ctx.tenantId),
          eq(chatMessages.channelId, channelId),
          eq(chatMessages.id, messageId),
        ),
      )
      .limit(1);
    return row ? mapTenantMessage(row) : null;
  }
  const [row] = await dbHandle
    .select()
    .from(platformChatMessages)
    .where(
      and(eq(platformChatMessages.channelId, channelId), eq(platformChatMessages.id, messageId)),
    )
    .limit(1);
  return row ? mapPlatformMessage(row) : null;
}

export async function listMessages(
  ctx: ChatContext,
  channelId: string,
  opts: {
    before?: string;
    after?: string;
    parentMessageId?: string;
    q?: string;
    pinnedOnly: boolean;
    limit: number;
  },
): Promise<{ messages: RawMessage[]; hasMore: boolean }> {
  const dbHandle = getScopeDb(ctx);
  const fetchLimit = opts.limit + 1;
  const term = opts.q?.trim();

  let cursorMessage: RawMessage | null = null;
  if (opts.before) {
    cursorMessage = await findMessageById(ctx, channelId, opts.before);
  } else if (opts.after) {
    cursorMessage = await findMessageById(ctx, channelId, opts.after);
  }

  if (ctx.scope === 'tenant') {
    const conditions = [
      eq(chatMessages.tenantId, ctx.tenantId),
      eq(chatMessages.channelId, channelId),
    ];
    if (opts.parentMessageId) {
      conditions.push(eq(chatMessages.parentMessageId, opts.parentMessageId));
    }
    if (opts.pinnedOnly) {
      conditions.push(eq(chatMessages.isPinned, true), isNull(chatMessages.deletedAt));
    }
    if (term) {
      conditions.push(ilike(chatMessages.body, `%${term}%`), isNull(chatMessages.deletedAt));
    }
    if (cursorMessage && opts.before) {
      conditions.push(
        or(
          lt(chatMessages.createdAt, cursorMessage.createdAt),
          and(
            eq(chatMessages.createdAt, cursorMessage.createdAt),
            lt(chatMessages.id, cursorMessage.id),
          ),
        )!,
      );
    } else if (cursorMessage && opts.after) {
      conditions.push(
        or(
          gt(chatMessages.createdAt, cursorMessage.createdAt),
          and(
            eq(chatMessages.createdAt, cursorMessage.createdAt),
            gt(chatMessages.id, cursorMessage.id),
          ),
        )!,
      );
    }

    const rows = await dbHandle
      .select()
      .from(chatMessages)
      .where(and(...conditions))
      .orderBy(
        opts.after ? asc(chatMessages.createdAt) : desc(chatMessages.createdAt),
        opts.after ? asc(chatMessages.id) : desc(chatMessages.id),
      )
      .limit(fetchLimit);

    const hasMore = rows.length > opts.limit;
    const sliced = hasMore ? rows.slice(0, opts.limit) : rows;
    const mapped = sliced.map(mapTenantMessage);
    if (!opts.after) mapped.reverse();
    return { messages: mapped, hasMore };
  }

  const conditions = [eq(platformChatMessages.channelId, channelId)];
  if (opts.parentMessageId) {
    conditions.push(eq(platformChatMessages.parentMessageId, opts.parentMessageId));
  }
  if (opts.pinnedOnly) {
    conditions.push(
      eq(platformChatMessages.isPinned, true),
      isNull(platformChatMessages.deletedAt),
    );
  }
  if (term) {
    conditions.push(
      ilike(platformChatMessages.body, `%${term}%`),
      isNull(platformChatMessages.deletedAt),
    );
  }
  if (cursorMessage && opts.before) {
    conditions.push(
      or(
        lt(platformChatMessages.createdAt, cursorMessage.createdAt),
        and(
          eq(platformChatMessages.createdAt, cursorMessage.createdAt),
          lt(platformChatMessages.id, cursorMessage.id),
        ),
      )!,
    );
  } else if (cursorMessage && opts.after) {
    conditions.push(
      or(
        gt(platformChatMessages.createdAt, cursorMessage.createdAt),
        and(
          eq(platformChatMessages.createdAt, cursorMessage.createdAt),
          gt(platformChatMessages.id, cursorMessage.id),
        ),
      )!,
    );
  }

  const rows = await dbHandle
    .select()
    .from(platformChatMessages)
    .where(and(...conditions))
    .orderBy(
      opts.after ? asc(platformChatMessages.createdAt) : desc(platformChatMessages.createdAt),
      opts.after ? asc(platformChatMessages.id) : desc(platformChatMessages.id),
    )
    .limit(fetchLimit);

  const hasMore = rows.length > opts.limit;
  const sliced = hasMore ? rows.slice(0, opts.limit) : rows;
  const mapped = sliced.map(mapPlatformMessage);
  if (!opts.after) mapped.reverse();
  return { messages: mapped, hasMore };
}

export async function findMessagesByIds(
  ctx: ChatContext,
  channelId: string,
  messageIds: string[],
): Promise<RawMessage[]> {
  const uniqueIds = Array.from(new Set(messageIds));
  if (uniqueIds.length === 0) return [];
  const dbHandle = getScopeDb(ctx);

  if (ctx.scope === 'tenant') {
    const rows = await dbHandle
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.tenantId, ctx.tenantId),
          eq(chatMessages.channelId, channelId),
          inArray(chatMessages.id, uniqueIds),
        ),
      );
    return rows.map(mapTenantMessage);
  }

  const rows = await dbHandle
    .select()
    .from(platformChatMessages)
    .where(
      and(
        eq(platformChatMessages.channelId, channelId),
        inArray(platformChatMessages.id, uniqueIds),
      ),
    );
  return rows.map(mapPlatformMessage);
}

export async function listReactionsForMessages(
  ctx: ChatContext,
  channelId: string,
  messageIds: string[],
): Promise<RawReaction[]> {
  const uniqueIds = Array.from(new Set(messageIds));
  if (uniqueIds.length === 0) return [];
  const dbHandle = getScopeDb(ctx);

  if (ctx.scope === 'tenant') {
    const rows = await dbHandle
      .select()
      .from(chatMessageReactions)
      .where(
        and(
          eq(chatMessageReactions.tenantId, ctx.tenantId),
          eq(chatMessageReactions.channelId, channelId),
          inArray(chatMessageReactions.messageId, uniqueIds),
        ),
      )
      .orderBy(asc(chatMessageReactions.createdAt));
    return rows.map(mapTenantReaction);
  }

  const rows = await dbHandle
    .select()
    .from(platformChatMessageReactions)
    .where(
      and(
        eq(platformChatMessageReactions.channelId, channelId),
        inArray(platformChatMessageReactions.messageId, uniqueIds),
      ),
    )
    .orderBy(asc(platformChatMessageReactions.createdAt));
  return rows.map(mapPlatformReaction);
}

export function groupReactions(
  reactions: RawReaction[],
  currentActorId: string,
): Map<string, ChatReactionSummary[]> {
  const byMessage = new Map<string, Map<string, string[]>>();
  for (const r of reactions) {
    let emojiMap = byMessage.get(r.messageId);
    if (!emojiMap) {
      emojiMap = new Map();
      byMessage.set(r.messageId, emojiMap);
    }
    const actors = emojiMap.get(r.emoji) ?? [];
    actors.push(r.actorId);
    emojiMap.set(r.emoji, actors);
  }

  const result = new Map<string, ChatReactionSummary[]>();
  for (const [messageId, emojiMap] of byMessage.entries()) {
    const summaries: ChatReactionSummary[] = [];
    for (const [emoji, actorIds] of emojiMap.entries()) {
      summaries.push({
        emoji,
        count: actorIds.length,
        actorIds,
        reactedByMe: actorIds.includes(currentActorId),
      });
    }
    result.set(messageId, summaries);
  }
  return result;
}

export async function listAttachmentsForMessages(
  ctx: ChatContext,
  channelId: string,
  messageIds: string[],
): Promise<Map<string, ChatAttachmentMetadata[]>> {
  const uniqueIds = Array.from(new Set(messageIds));
  const map = new Map<string, ChatAttachmentMetadata[]>();
  if (uniqueIds.length === 0) return map;
  const dbHandle = getScopeDb(ctx);

  if (ctx.scope === 'tenant') {
    const rows = await dbHandle
      .select()
      .from(chatMessageAttachments)
      .where(
        and(
          eq(chatMessageAttachments.tenantId, ctx.tenantId),
          eq(chatMessageAttachments.channelId, channelId),
          inArray(chatMessageAttachments.messageId, uniqueIds),
        ),
      )
      .orderBy(asc(chatMessageAttachments.position));

    for (const r of rows) {
      const list = map.get(r.messageId) ?? [];
      list.push({
        id: r.id,
        key: r.storageKey,
        filename: r.filename,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
      });
      map.set(r.messageId, list);
    }
    return map;
  }

  const rows = await dbHandle
    .select()
    .from(platformChatMessageAttachments)
    .where(
      and(
        eq(platformChatMessageAttachments.channelId, channelId),
        inArray(platformChatMessageAttachments.messageId, uniqueIds),
      ),
    )
    .orderBy(asc(platformChatMessageAttachments.position));

  for (const r of rows) {
    const list = map.get(r.messageId) ?? [];
    list.push({
      id: r.id,
      key: r.storageKey,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
    });
    map.set(r.messageId, list);
  }
  return map;
}

export async function listMentionsForMessages(
  ctx: ChatContext,
  channelId: string,
  messageIds: string[],
): Promise<Map<string, string[]>> {
  const uniqueIds = Array.from(new Set(messageIds));
  const map = new Map<string, string[]>();
  if (uniqueIds.length === 0) return map;
  const dbHandle = getScopeDb(ctx);

  if (ctx.scope === 'tenant') {
    const rows = await dbHandle
      .select({
        messageId: chatMessageMentions.messageId,
        actorId: chatMessageMentions.mentionedUserId,
      })
      .from(chatMessageMentions)
      .where(
        and(
          eq(chatMessageMentions.tenantId, ctx.tenantId),
          eq(chatMessageMentions.channelId, channelId),
          inArray(chatMessageMentions.messageId, uniqueIds),
        ),
      );
    for (const r of rows) {
      const list = map.get(r.messageId) ?? [];
      list.push(r.actorId);
      map.set(r.messageId, list);
    }
    return map;
  }

  const rows = await dbHandle
    .select({
      messageId: platformChatMessageMentions.messageId,
      actorId: platformChatMessageMentions.mentionedStaffId,
    })
    .from(platformChatMessageMentions)
    .where(
      and(
        eq(platformChatMessageMentions.channelId, channelId),
        inArray(platformChatMessageMentions.messageId, uniqueIds),
      ),
    );
  for (const r of rows) {
    const list = map.get(r.messageId) ?? [];
    list.push(r.actorId);
    map.set(r.messageId, list);
  }
  return map;
}

export async function isAttachmentMessageDeleted(
  ctx: ChatContext,
  channelId: string,
  storageKey: string,
): Promise<boolean> {
  const dbHandle = getScopeDb(ctx);
  if (ctx.scope === 'tenant') {
    const [row] = await dbHandle
      .select({ deletedAt: chatMessages.deletedAt })
      .from(chatMessageAttachments)
      .innerJoin(
        chatMessages,
        and(
          eq(chatMessages.tenantId, chatMessageAttachments.tenantId),
          eq(chatMessages.channelId, chatMessageAttachments.channelId),
          eq(chatMessages.id, chatMessageAttachments.messageId),
        ),
      )
      .where(
        and(
          eq(chatMessageAttachments.tenantId, ctx.tenantId),
          eq(chatMessageAttachments.channelId, channelId),
          eq(chatMessageAttachments.storageKey, storageKey),
        ),
      )
      .limit(1);
    return Boolean(row?.deletedAt);
  }

  const [row] = await dbHandle
    .select({ deletedAt: platformChatMessages.deletedAt })
    .from(platformChatMessageAttachments)
    .innerJoin(
      platformChatMessages,
      and(
        eq(platformChatMessages.channelId, platformChatMessageAttachments.channelId),
        eq(platformChatMessages.id, platformChatMessageAttachments.messageId),
      ),
    )
    .where(
      and(
        eq(platformChatMessageAttachments.channelId, channelId),
        eq(platformChatMessageAttachments.storageKey, storageKey),
      ),
    )
    .limit(1);
  return Boolean(row?.deletedAt);
}

export async function createMessage(
  ctx: ChatContext,
  data: {
    channelId: string;
    type: ChatMessageType;
    body: string;
    parentMessageId: string | null;
    mentions: string[];
    attachments: ChatAttachmentMetadata[];
    previewText: string;
  },
): Promise<RawMessage> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();

  return dbHandle.transaction(async (tx) => {
    if (ctx.scope === 'tenant') {
      const [inserted] = await tx
        .insert(chatMessages)
        .values({
          tenantId: ctx.tenantId,
          channelId: data.channelId,
          senderId: ctx.actorId,
          type: data.type,
          body: data.body,
          parentMessageId: data.parentMessageId,
        })
        .returning();

      if (data.attachments.length > 0) {
        await tx.insert(chatMessageAttachments).values(
          data.attachments.map((att, idx) => ({
            id: att.id,
            tenantId: ctx.tenantId,
            channelId: data.channelId,
            messageId: inserted!.id,
            storageKey: att.key,
            filename: att.filename,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            position: idx,
          })),
        );
      }

      if (data.mentions.length > 0) {
        await tx
          .insert(chatMessageMentions)
          .values(
            data.mentions.map((actorId) => ({
              tenantId: ctx.tenantId,
              channelId: data.channelId,
              messageId: inserted!.id,
              mentionedUserId: actorId,
            })),
          )
          .onConflictDoNothing();
      }

      await tx
        .update(chatChannels)
        .set({
          lastMessageAt: inserted!.createdAt,
          lastMessagePreview: data.previewText,
          lastMessageSenderId: ctx.actorId,
          messageCount: sql`${chatChannels.messageCount} + 1`,
          updatedAt: now,
        })
        .where(and(eq(chatChannels.tenantId, ctx.tenantId), eq(chatChannels.id, data.channelId)));

      if (data.parentMessageId) {
        await tx
          .update(chatMessages)
          .set({ replyCount: sql`${chatMessages.replyCount} + 1`, updatedAt: now })
          .where(
            and(
              eq(chatMessages.tenantId, ctx.tenantId),
              eq(chatMessages.channelId, data.channelId),
              eq(chatMessages.id, data.parentMessageId),
            ),
          );
      }

      await tx
        .update(chatChannelMembers)
        .set({
          unreadCount: sql`${chatChannelMembers.unreadCount} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(chatChannelMembers.tenantId, ctx.tenantId),
            eq(chatChannelMembers.channelId, data.channelId),
            ne(chatChannelMembers.userId, ctx.actorId),
            isNull(chatChannelMembers.leftAt),
          ),
        );

      await tx
        .update(chatChannelMembers)
        .set({
          unreadCount: 0,
          lastReadAt: inserted!.createdAt,
          lastReadMessageId: inserted!.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(chatChannelMembers.tenantId, ctx.tenantId),
            eq(chatChannelMembers.channelId, data.channelId),
            eq(chatChannelMembers.userId, ctx.actorId),
            isNull(chatChannelMembers.leftAt),
          ),
        );

      return mapTenantMessage(inserted!);
    }

    const [inserted] = await tx
      .insert(platformChatMessages)
      .values({
        channelId: data.channelId,
        senderId: ctx.actorId,
        type: data.type,
        body: data.body,
        parentMessageId: data.parentMessageId,
      })
      .returning();

    if (data.attachments.length > 0) {
      await tx.insert(platformChatMessageAttachments).values(
        data.attachments.map((att, idx) => ({
          id: att.id,
          channelId: data.channelId,
          messageId: inserted!.id,
          storageKey: att.key,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          position: idx,
        })),
      );
    }

    if (data.mentions.length > 0) {
      await tx
        .insert(platformChatMessageMentions)
        .values(
          data.mentions.map((actorId) => ({
            channelId: data.channelId,
            messageId: inserted!.id,
            mentionedStaffId: actorId,
          })),
        )
        .onConflictDoNothing();
    }

    await tx
      .update(platformChatChannels)
      .set({
        lastMessageAt: inserted!.createdAt,
        lastMessagePreview: data.previewText,
        lastMessageSenderId: ctx.actorId,
        messageCount: sql`${platformChatChannels.messageCount} + 1`,
        updatedAt: now,
      })
      .where(eq(platformChatChannels.id, data.channelId));

    if (data.parentMessageId) {
      await tx
        .update(platformChatMessages)
        .set({ replyCount: sql`${platformChatMessages.replyCount} + 1`, updatedAt: now })
        .where(
          and(
            eq(platformChatMessages.channelId, data.channelId),
            eq(platformChatMessages.id, data.parentMessageId),
          ),
        );
    }

    await tx
      .update(platformChatChannelMembers)
      .set({
        unreadCount: sql`${platformChatChannelMembers.unreadCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(platformChatChannelMembers.channelId, data.channelId),
          ne(platformChatChannelMembers.staffId, ctx.actorId),
          isNull(platformChatChannelMembers.leftAt),
        ),
      );

    await tx
      .update(platformChatChannelMembers)
      .set({
        unreadCount: 0,
        lastReadAt: inserted!.createdAt,
        lastReadMessageId: inserted!.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(platformChatChannelMembers.channelId, data.channelId),
          eq(platformChatChannelMembers.staffId, ctx.actorId),
          isNull(platformChatChannelMembers.leftAt),
        ),
      );

    return mapPlatformMessage(inserted!);
  });
}

export async function updateMessageBody(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
  body: string,
  mentions?: string[],
): Promise<RawMessage | null> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();
  const patch = {
    body,
    editedAt: now,
    updatedAt: now,
  };

  return dbHandle.transaction(async (tx) => {
    if (ctx.scope === 'tenant') {
      const [updated] = await tx
        .update(chatMessages)
        .set(patch)
        .where(
          and(
            eq(chatMessages.tenantId, ctx.tenantId),
            eq(chatMessages.channelId, channelId),
            eq(chatMessages.id, messageId),
            isNull(chatMessages.deletedAt),
          ),
        )
        .returning();
      if (!updated) return null;

      if (mentions !== undefined) {
        await tx
          .delete(chatMessageMentions)
          .where(
            and(
              eq(chatMessageMentions.tenantId, ctx.tenantId),
              eq(chatMessageMentions.messageId, messageId),
            ),
          );
        if (mentions.length > 0) {
          await tx
            .insert(chatMessageMentions)
            .values(
              mentions.map((actorId) => ({
                tenantId: ctx.tenantId,
                channelId,
                messageId,
                mentionedUserId: actorId,
              })),
            )
            .onConflictDoNothing();
        }
      }
      return mapTenantMessage(updated);
    }

    const [updated] = await tx
      .update(platformChatMessages)
      .set(patch)
      .where(
        and(
          eq(platformChatMessages.channelId, channelId),
          eq(platformChatMessages.id, messageId),
          isNull(platformChatMessages.deletedAt),
        ),
      )
      .returning();
    if (!updated) return null;

    if (mentions !== undefined) {
      await tx
        .delete(platformChatMessageMentions)
        .where(eq(platformChatMessageMentions.messageId, messageId));
      if (mentions.length > 0) {
        await tx
          .insert(platformChatMessageMentions)
          .values(
            mentions.map((actorId) => ({
              channelId,
              messageId,
              mentionedStaffId: actorId,
            })),
          )
          .onConflictDoNothing();
      }
    }
    return mapPlatformMessage(updated);
  });
}

export async function softDeleteMessage(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
): Promise<RawMessage | null> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();

  if (ctx.scope === 'tenant') {
    const [updated] = await dbHandle
      .update(chatMessages)
      .set({
        deletedAt: now,
        deletedByUserId: ctx.actorId,
        isPinned: false,
        pinnedAt: null,
        pinnedByUserId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatMessages.tenantId, ctx.tenantId),
          eq(chatMessages.channelId, channelId),
          eq(chatMessages.id, messageId),
          isNull(chatMessages.deletedAt),
        ),
      )
      .returning();
    return updated ? mapTenantMessage(updated) : null;
  }

  const [updated] = await dbHandle
    .update(platformChatMessages)
    .set({
      deletedAt: now,
      deletedByStaffId: ctx.actorId,
      isPinned: false,
      pinnedAt: null,
      pinnedByStaffId: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(platformChatMessages.channelId, channelId),
        eq(platformChatMessages.id, messageId),
        isNull(platformChatMessages.deletedAt),
      ),
    )
    .returning();
  return updated ? mapPlatformMessage(updated) : null;
}

export async function setMessagePin(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
  isPinned: boolean,
): Promise<RawMessage | null> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();

  if (ctx.scope === 'tenant') {
    const [updated] = await dbHandle
      .update(chatMessages)
      .set({
        isPinned,
        pinnedAt: isPinned ? now : null,
        pinnedByUserId: isPinned ? ctx.actorId : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatMessages.tenantId, ctx.tenantId),
          eq(chatMessages.channelId, channelId),
          eq(chatMessages.id, messageId),
          isNull(chatMessages.deletedAt),
        ),
      )
      .returning();
    return updated ? mapTenantMessage(updated) : null;
  }

  const [updated] = await dbHandle
    .update(platformChatMessages)
    .set({
      isPinned,
      pinnedAt: isPinned ? now : null,
      pinnedByStaffId: isPinned ? ctx.actorId : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(platformChatMessages.channelId, channelId),
        eq(platformChatMessages.id, messageId),
        isNull(platformChatMessages.deletedAt),
      ),
    )
    .returning();
  return updated ? mapPlatformMessage(updated) : null;
}

export async function toggleReaction(
  ctx: ChatContext,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<{ added: boolean; reactions: RawReaction[] }> {
  const dbHandle = getScopeDb(ctx);

  return dbHandle.transaction(async (tx) => {
    let added: boolean;

    if (ctx.scope === 'tenant') {
      const [existing] = await tx
        .select({ id: chatMessageReactions.id })
        .from(chatMessageReactions)
        .where(
          and(
            eq(chatMessageReactions.tenantId, ctx.tenantId),
            eq(chatMessageReactions.messageId, messageId),
            eq(chatMessageReactions.userId, ctx.actorId),
            eq(chatMessageReactions.emoji, emoji),
          ),
        )
        .limit(1);

      if (existing) {
        await tx.delete(chatMessageReactions).where(eq(chatMessageReactions.id, existing.id));
        added = false;
      } else {
        await tx.insert(chatMessageReactions).values({
          tenantId: ctx.tenantId,
          channelId,
          messageId,
          userId: ctx.actorId,
          emoji,
        });
        added = true;
      }

      const rows = await tx
        .select()
        .from(chatMessageReactions)
        .where(
          and(
            eq(chatMessageReactions.tenantId, ctx.tenantId),
            eq(chatMessageReactions.messageId, messageId),
          ),
        )
        .orderBy(asc(chatMessageReactions.createdAt));
      return { added, reactions: rows.map(mapTenantReaction) };
    }

    const [existing] = await tx
      .select({ id: platformChatMessageReactions.id })
      .from(platformChatMessageReactions)
      .where(
        and(
          eq(platformChatMessageReactions.messageId, messageId),
          eq(platformChatMessageReactions.staffId, ctx.actorId),
          eq(platformChatMessageReactions.emoji, emoji),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .delete(platformChatMessageReactions)
        .where(eq(platformChatMessageReactions.id, existing.id));
      added = false;
    } else {
      await tx.insert(platformChatMessageReactions).values({
        channelId,
        messageId,
        staffId: ctx.actorId,
        emoji,
      });
      added = true;
    }

    const rows = await tx
      .select()
      .from(platformChatMessageReactions)
      .where(eq(platformChatMessageReactions.messageId, messageId))
      .orderBy(asc(platformChatMessageReactions.createdAt));
    return { added, reactions: rows.map(mapPlatformReaction) };
  });
}

export async function markChannelRead(
  ctx: ChatContext,
  channelId: string,
  lastReadMessageId?: string,
  cursorAt?: Date,
): Promise<RawMember | null> {
  const dbHandle = getScopeDb(ctx);
  const now = new Date();
  const targetReadAt = cursorAt ?? now;

  return dbHandle.transaction(async (tx) => {
    const current = await findMember(ctx, channelId, ctx.actorId);
    if (!current) return null;

    // Advance read cursor monotonically so out-of-order client calls never rewind lastReadAt.
    // Use strict > so that two messages created in the same millisecond don't allow a rewind.
    const shouldAdvance = !current.lastReadAt || targetReadAt > current.lastReadAt;
    const nextReadAt = shouldAdvance ? targetReadAt : current.lastReadAt;
    const nextReadMessageId = shouldAdvance
      ? (lastReadMessageId ?? current.lastReadMessageId)
      : current.lastReadMessageId;
    const nextUnreadCount = shouldAdvance ? 0 : current.unreadCount;

    if (ctx.scope === 'tenant') {
      const [updated] = await tx
        .update(chatChannelMembers)
        .set({
          unreadCount: nextUnreadCount,
          lastReadAt: nextReadAt,
          lastReadMessageId: nextReadMessageId,
          updatedAt: now,
        })
        .where(
          and(
            eq(chatChannelMembers.tenantId, ctx.tenantId),
            eq(chatChannelMembers.channelId, channelId),
            eq(chatChannelMembers.userId, ctx.actorId),
            isNull(chatChannelMembers.leftAt),
          ),
        )
        .returning();
      return updated ? mapTenantMember(updated) : null;
    }

    const [updated] = await tx
      .update(platformChatChannelMembers)
      .set({
        unreadCount: nextUnreadCount,
        lastReadAt: nextReadAt,
        lastReadMessageId: nextReadMessageId,
        updatedAt: now,
      })
      .where(
        and(
          eq(platformChatChannelMembers.channelId, channelId),
          eq(platformChatChannelMembers.staffId, ctx.actorId),
          isNull(platformChatChannelMembers.leftAt),
        ),
      )
      .returning();
    return updated ? mapPlatformMember(updated) : null;
  });
}
