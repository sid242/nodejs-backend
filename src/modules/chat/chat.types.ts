import type { ChatAttachmentMetadata } from '@/db/schema/chat';

export type ChatScope = 'tenant' | 'platform';

export type ChatChannelType = 'DIRECT' | 'GROUP' | 'PUBLIC' | 'PRIVATE';
export type ChatParticipantRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type ChatMessageType = 'TEXT' | 'SYSTEM';

export type ChatContext =
  | {
      scope: 'tenant';
      tenantId: string;
      actorId: string;
      canManage: boolean;
    }
  | {
      scope: 'platform';
      tenantId: null;
      actorId: string;
      canManage: boolean;
    };

export interface ChatParticipantProfile {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string | null;
  isOnline: boolean;
}

export interface ChatMemberView {
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
  profile: ChatParticipantProfile;
}

export interface ChatChannelView {
  id: string;
  scope: ChatScope;
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
  memberCount: number;
  isMember: boolean;
  myRole: ChatParticipantRole | null;
  isMuted: boolean;
  isPinned: boolean;
  unreadCount: number;
  lastReadMessageId: string | null;
  peer: ChatParticipantProfile | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatReactionSummary {
  emoji: string;
  count: number;
  actorIds: string[];
  reactedByMe: boolean;
}

export interface ChatMessageParentPreview {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  deletedAt: Date | null;
}

export interface ChatMessageView {
  id: string;
  channelId: string;
  senderId: string;
  sender: ChatParticipantProfile;
  type: ChatMessageType;
  body: string;
  parentMessageId: string | null;
  parentMessage: ChatMessageParentPreview | null;
  replyCount: number;
  mentions: string[];
  attachments: ChatAttachmentMetadata[];
  reactions: ChatReactionSummary[];
  isPinned: boolean;
  pinnedByActorId: string | null;
  pinnedAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatPaginatedMessages {
  items: ChatMessageView[];
  hasMore: boolean;
  nextCursor: string | null;
}
