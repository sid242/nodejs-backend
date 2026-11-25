import type { Server, Socket } from 'socket.io';

import type { TenantRoutingContext } from '@/db/tenancy/tenant-db';
import type { SupportTokenPayload } from '@/modules/auth/tokens';
import type { loadActiveSupportAccess } from '@/modules/platform/support-access';

export type SocketActorType = 'USER' | 'STAFF' | 'SUPPORT';

export type SupportSessionRecord = Awaited<ReturnType<typeof loadActiveSupportAccess>>['session'];

export interface SocketUser {
  id: string;
}

export interface SocketManager {
  io: Server;
  close: () => Promise<void>;
}

export interface SocketAuthState {
  actorType: SocketActorType;
  user: SocketUser;
  staffId?: string;
  workspaceTenantId?: string;
  workspaceTenant?: TenantRoutingContext;
  isSupportSession?: boolean;
  supportSession?: SupportSessionRecord;
  supportClaims?: SupportTokenPayload;
}

export function getSocketAuthState(socket: Socket): SocketAuthState {
  return socket.data as SocketAuthState;
}
