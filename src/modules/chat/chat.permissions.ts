import type { DomainModuleDefinition } from '@/modules/rbac/modules.types';

export const chatModuleDefinition: DomainModuleDefinition = {
  key: 'chat',
  name: 'Team Chat',
  description:
    'Real-time channels, direct messages, threads, reactions, and file sharing for workspace members',
  permissions: [
    {
      key: 'chat:read',
      name: 'Read Team Chat',
      action: 'read',
      description: 'View workspace channels, direct messages, and message history',
    },
    {
      key: 'chat:write',
      name: 'Send Chat Messages',
      action: 'write',
      description:
        'Send messages, react, share attachments, and create channels or direct messages',
    },
    {
      key: 'chat:manage',
      name: 'Manage Chat Channels',
      action: 'manage',
      description: 'Manage workspace channels, membership, pinned messages, and moderation',
    },
  ],
};
