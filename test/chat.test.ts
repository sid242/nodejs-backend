import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
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
  tenants,
  users,
} from '@/db/schema/index';
import { withTenantTransaction } from '@/db/tenancy/rls';
import { generateOpenApiDocument } from '@/docs/openapi';
import {
  createChannelDto,
  createDirectChannelDto,
  listMessagesQueryDto,
  presignAttachmentDto,
  sendMessageDto,
  toggleReactionDto,
} from '@/modules/chat/chat.dto';
import { chatModuleDefinition } from '@/modules/chat/chat.permissions';
import * as chatService from '@/modules/chat/chat.service';
import type { ChatContext } from '@/modules/chat/chat.types';
import {
  PLATFORM_PERMISSION_CATALOGUE,
  PLATFORM_PERMISSIONS,
} from '@/modules/platform/platform.permissions';
import { SYSTEM_MODULE_DEFINITIONS } from '@/modules/rbac/modules.registry';

describe('Chat Module — Tenant & Platform Full Chat Suite', () => {
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdStaffIds: string[] = [];
  const createdPlatformRoleIds: string[] = [];
  const createdPlatformChannelIds: string[] = [];

  after(async () => {
    try {
      // Delete in FK-safe order: child tables → parent tables

      // 1. Platform chat data (mentions/attachments → reactions → messages → members → channels)
      if (createdPlatformChannelIds.length > 0) {
        await db
          .delete(platformChatMessageMentions)
          .where(inArray(platformChatMessageMentions.channelId, createdPlatformChannelIds));
        await db
          .delete(platformChatMessageAttachments)
          .where(inArray(platformChatMessageAttachments.channelId, createdPlatformChannelIds));
        await db
          .delete(platformChatMessageReactions)
          .where(inArray(platformChatMessageReactions.channelId, createdPlatformChannelIds));
        await db
          .delete(platformChatMessages)
          .where(inArray(platformChatMessages.channelId, createdPlatformChannelIds));
        await db
          .delete(platformChatChannelMembers)
          .where(inArray(platformChatChannelMembers.channelId, createdPlatformChannelIds));
        await db
          .delete(platformChatChannels)
          .where(inArray(platformChatChannels.id, createdPlatformChannelIds));
      }

      // 2. Tenant chat data (mentions/attachments → reactions → messages → members → channels)
      if (createdTenantIds.length > 0) {
        await db
          .delete(chatMessageMentions)
          .where(inArray(chatMessageMentions.tenantId, createdTenantIds));
        await db
          .delete(chatMessageAttachments)
          .where(inArray(chatMessageAttachments.tenantId, createdTenantIds));
        await db
          .delete(chatMessageReactions)
          .where(inArray(chatMessageReactions.tenantId, createdTenantIds));
        await db.delete(chatMessages).where(inArray(chatMessages.tenantId, createdTenantIds));
        await db
          .delete(chatChannelMembers)
          .where(inArray(chatChannelMembers.tenantId, createdTenantIds));
        await db.delete(chatChannels).where(inArray(chatChannels.tenantId, createdTenantIds));
      }

      // 3. Staff, roles, tenants, users
      if (createdStaffIds.length > 0) {
        await db.delete(platformStaff).where(inArray(platformStaff.id, createdStaffIds));
      }
      if (createdPlatformRoleIds.length > 0) {
        await db.delete(platformRoles).where(inArray(platformRoles.id, createdPlatformRoleIds));
      }
      if (createdTenantIds.length > 0) {
        await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      }
    } finally {
      await Promise.allSettled([closeRedisClients(), closeDb()]);
    }
  });

  describe('1. DTO Contracts, Permissions & OpenAPI Registration', () => {
    it('validates chat channel, direct message, and message payloads', () => {
      const ch = createChannelDto.parse({
        type: 'PUBLIC',
        name: 'Engineering Updates',
        topic: 'Daily standups & releases',
      });
      assert.equal(ch.type, 'PUBLIC');
      assert.equal(ch.name, 'Engineering Updates');

      const dm = createDirectChannelDto.parse({
        targetActorId: '11111111-1111-4111-8111-111111111111',
      });
      assert.equal(dm.targetActorId, '11111111-1111-4111-8111-111111111111');

      assert.throws(() => sendMessageDto.parse({ body: '   ', attachments: [] }));

      const withAttachment = sendMessageDto.parse({
        body: '',
        attachments: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            key: 'chat/t/c/f/spec.pdf',
            filename: 'spec.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      });
      assert.equal(withAttachment.attachments.length, 1);

      const rx = toggleReactionDto.parse({ emoji: '👍' });
      assert.equal(rx.emoji, '👍');

      assert.throws(() =>
        presignAttachmentDto.parse({
          channelId: '33333333-3333-4333-8333-333333333333',
          filename: 'script.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 100,
        }),
      );

      const listQ = listMessagesQueryDto.parse({ limit: '25', pinnedOnly: 'true' });
      assert.equal(listQ.limit, 25);
      assert.equal(listQ.pinnedOnly, true);
    });

    it('registers tenant and platform chat permissions and OpenAPI paths', () => {
      const regMod = SYSTEM_MODULE_DEFINITIONS.find((m) => m.key === chatModuleDefinition.key);
      assert.ok(regMod, 'chatModuleDefinition should be in SYSTEM_MODULE_DEFINITIONS');
      assert.deepEqual(
        regMod.permissions.map((p) => p.key),
        ['chat:read', 'chat:write', 'chat:manage'],
      );

      const platKeys = new Set(PLATFORM_PERMISSION_CATALOGUE.map((p) => p.key));
      assert.ok(platKeys.has(PLATFORM_PERMISSIONS.CHAT_READ));
      assert.ok(platKeys.has(PLATFORM_PERMISSIONS.CHAT_WRITE));
      assert.ok(platKeys.has(PLATFORM_PERMISSIONS.CHAT_MANAGE));

      const doc = generateOpenApiDocument();
      assert.ok(doc.paths['/api/v1/chat/channels']);
      assert.ok(doc.paths['/api/v1/platform/chat/channels']);
      assert.ok(doc.paths['/api/v1/chat/channels/{channelId}/messages']);
      assert.ok(doc.paths['/api/v1/platform/chat/channels/{channelId}/messages']);
    });
  });

  describe('2. Tenant Member Chat Lifecycle & RLS Isolation', () => {
    it('supports channels, direct message deduplication, threads, reactions, pins, read receipts, soft-delete, and tenant isolation', async () => {
      const suffix = randomUUID().slice(0, 8);
      const [tenantA] = await db
        .insert(tenants)
        .values({ name: `Chat Tenant A ${suffix}`, slug: `chat-a-${suffix}` })
        .returning();
      const [tenantB] = await db
        .insert(tenants)
        .values({ name: `Chat Tenant B ${suffix}`, slug: `chat-b-${suffix}` })
        .returning();
      createdTenantIds.push(tenantA!.id, tenantB!.id);

      const [user1] = await db
        .insert(users)
        .values({
          email: `chat-u1-${suffix}@example.com`,
          passwordHash: 'hash',
          firstName: 'Alice',
          lastName: 'Chen',
          emailVerifiedAt: new Date(),
        })
        .returning();
      const [user2] = await db
        .insert(users)
        .values({
          email: `chat-u2-${suffix}@example.com`,
          passwordHash: 'hash',
          firstName: 'Bob',
          lastName: 'Rao',
          emailVerifiedAt: new Date(),
        })
        .returning();
      createdUserIds.push(user1!.id, user2!.id);

      await db.insert(tenantMembers).values([
        { tenantId: tenantA!.id, userId: user1!.id, status: 'ACTIVE', jobTitle: 'Engineer' },
        { tenantId: tenantA!.id, userId: user2!.id, status: 'ACTIVE', jobTitle: 'Designer' },
        { tenantId: tenantB!.id, userId: user2!.id, status: 'ACTIVE', jobTitle: 'External' },
      ]);

      const ctx1: ChatContext = {
        scope: 'tenant',
        tenantId: tenantA!.id,
        actorId: user1!.id,
        canManage: true,
      };
      const ctx2: ChatContext = {
        scope: 'tenant',
        tenantId: tenantA!.id,
        actorId: user2!.id,
        canManage: false,
      };
      const ctxB: ChatContext = {
        scope: 'tenant',
        tenantId: tenantB!.id,
        actorId: user2!.id,
        canManage: true,
      };

      await withTenantTransaction(tenantA!.id, async () => {
        const contacts = await chatService.listContacts(ctx1, {});
        assert.equal(contacts.length, 2);

        const publicChan = await chatService.createChannel(ctx1, {
          type: 'PUBLIC',
          name: 'General',
          description: 'Workspace announcements',
          topic: 'Welcome!',
          memberIds: [],
        });
        assert.equal(publicChan.slug, 'general');
        assert.equal(publicChan.isMember, true);

        const joined = await chatService.joinChannel(ctx2, publicChan.id);
        assert.equal(joined.memberCount, 2);

        const rootMsg = await chatService.sendMessage(ctx1, publicChan.id, {
          body: 'Hello @Bob Rao!',
          mentions: [user2!.id],
          attachments: [],
        });
        assert.equal(rootMsg.sender.displayName, 'Alice Chen');
        assert.deepEqual(rootMsg.mentions, [user2!.id]);

        const channelsForUser2 = await chatService.listChannels(ctx2, { includeArchived: false });
        const publicForU2 = channelsForUser2.find((c) => c.id === publicChan.id);
        assert.equal(publicForU2?.unreadCount, 1);

        const reply = await chatService.sendMessage(ctx2, publicChan.id, {
          body: 'Hi Alice!',
          parentMessageId: rootMsg.id,
          mentions: [],
          attachments: [],
        });
        assert.equal(reply.parentMessage?.id, rootMsg.id);

        const toggledRx = await chatService.toggleReaction(ctx2, publicChan.id, rootMsg.id, {
          emoji: '🚀',
        });
        assert.equal(toggledRx.added, true);
        assert.equal(toggledRx.reactions[0]?.count, 1);

        const pinned = await chatService.togglePinMessage(ctx1, publicChan.id, rootMsg.id);
        assert.equal(pinned.isPinned, true);

        const edited = await chatService.editMessage(ctx1, publicChan.id, rootMsg.id, {
          body: 'Hello @Bob Rao! (updated)',
        });
        assert.ok(edited.editedAt);
        assert.equal(edited.body, 'Hello @Bob Rao! (updated)');

        const readRes = await chatService.markChannelRead(ctx2, publicChan.id, {
          lastReadMessageId: reply.id,
        });
        assert.equal(readRes.unreadCount, 0);
        assert.equal(readRes.lastReadMessageId, reply.id);

        // Monotonic cursor: marking an older message must not rewind lastReadMessageId
        const rewoundAttempt = await chatService.markChannelRead(ctx2, publicChan.id, {
          lastReadMessageId: rootMsg.id,
        });
        assert.equal(rewoundAttempt.lastReadMessageId, reply.id);

        const dm1 = await chatService.createOrGetDirectChannel(ctx1, {
          targetActorId: user2!.id,
        });
        const dm2 = await chatService.createOrGetDirectChannel(ctx2, {
          targetActorId: user1!.id,
        });
        assert.equal(dm1.id, dm2.id);
        assert.equal(dm1.peer?.id, user2!.id);
        assert.equal(dm2.peer?.id, user1!.id);

        await chatService.deleteMessage(ctx2, publicChan.id, reply.id);
        const listAfterDelete = await chatService.listMessages(ctx1, publicChan.id, {
          limit: 20,
          pinnedOnly: false,
        });
        const deletedMsg = listAfterDelete.items.find((m) => m.id === reply.id);
        assert.ok(deletedMsg?.deletedAt);
        assert.equal(deletedMsg?.body, '');

        // Soft departure (leftAt) preserves message FK integrity and allows clean rejoin
        await chatService.leaveChannel(ctx2, publicChan.id);
        const detailsAfterLeave = await chatService.getChannelDetails(ctx1, publicChan.id);
        assert.equal(detailsAfterLeave.members.length, 1);
        const rejoined = await chatService.joinChannel(ctx2, publicChan.id);
        assert.equal(rejoined.memberCount, 2);
      });

      // Cross-tenant isolation check: Tenant B cannot read Tenant A channels
      await withTenantTransaction(tenantB!.id, async () => {
        const tenantBChannels = await chatService.listChannels(ctxB, { includeArchived: false });
        assert.equal(tenantBChannels.length, 0);
      });
    });
  });

  describe('3. Platform Staff Chat Lifecycle & Private Access Control', () => {
    it('supports internal platform staff channels, DMs, and private channel access enforcement', async () => {
      const suffix = randomUUID().slice(0, 8);
      const [role] = await db
        .insert(platformRoles)
        .values({
          key: `CHAT_TEST_${suffix}`,
          name: 'Chat Tester Role',
          isSystem: false,
        })
        .returning();
      createdPlatformRoleIds.push(role!.id);

      const [staff1] = await db
        .insert(platformStaff)
        .values({
          email: `staff1-${suffix}@platform.local`,
          displayName: 'Priya Operator',
          passwordHash: 'hash',
          roleId: role!.id,
          status: 'ACTIVE',
        })
        .returning();
      const [staff2] = await db
        .insert(platformStaff)
        .values({
          email: `staff2-${suffix}@platform.local`,
          displayName: 'Sam SRE',
          passwordHash: 'hash',
          roleId: role!.id,
          status: 'ACTIVE',
        })
        .returning();
      createdStaffIds.push(staff1!.id, staff2!.id);

      const s1Ctx: ChatContext = {
        scope: 'platform',
        tenantId: null,
        actorId: staff1!.id,
        canManage: true,
      };
      const s2Ctx: ChatContext = {
        scope: 'platform',
        tenantId: null,
        actorId: staff2!.id,
        canManage: false,
      };

      const contacts = await chatService.listContacts(s1Ctx, { q: 'Sam SRE' });
      assert.equal(contacts.length, 1);
      assert.equal(contacts[0]?.id, staff2!.id);

      const privateChan = await chatService.createChannel(s1Ctx, {
        type: 'PRIVATE',
        name: `Incident War Room ${suffix}`,
        description: 'On-call escalation channel',
        memberIds: [],
      });
      createdPlatformChannelIds.push(privateChan.id);

      // Non-member cannot read private platform channel
      await assert.rejects(() =>
        chatService.listMessages(s2Ctx, privateChan.id, { limit: 20, pinnedOnly: false }),
      );

      // Add staff2 and exchange messages
      const members = await chatService.addChannelMembers(s1Ctx, privateChan.id, {
        memberIds: [staff2!.id],
      });
      assert.equal(members.length, 2);

      const msg = await chatService.sendMessage(s2Ctx, privateChan.id, {
        body: 'Investigating DB latency alert',
        mentions: [],
        attachments: [],
      });
      assert.equal(msg.sender.displayName, 'Sam SRE');

      const dm = await chatService.createOrGetDirectChannel(s1Ctx, {
        targetActorId: staff2!.id,
      });
      createdPlatformChannelIds.push(dm.id);
      assert.equal(dm.type, 'DIRECT');
      assert.equal(dm.peer?.id, staff2!.id);

      // Verify clean DB removal works via cascade
      await db.delete(platformChatChannels).where(eq(platformChatChannels.id, privateChan.id));
    });
  });
});
