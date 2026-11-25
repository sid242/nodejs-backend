export type PushChannel = 'webpush' | 'fcm' | 'apns';
export type PushPlatform = 'web' | 'android' | 'ios';
export type PushActorType = 'USER' | 'STAFF';

export interface PushActor {
  actorType: PushActorType;
  actorId: string;
}

export interface PushDevice {
  id: string;
  actorType: PushActorType;
  actorId: string;
  channel: PushChannel;
  platform: PushPlatform | string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  token: string | null;
  failureCount: number;
}

export interface PushMessage {
  notificationId: string;
  title: string;
  body: string;
  link?: string | null;
  tenantId?: string | null;
  category?: string;
  tag?: string;
}

export type PushResult =
  | { status: 'sent' }
  | { status: 'gone'; statusCode?: number }
  | { status: 'retry'; retryAfterMs?: number; statusCode?: number; reason?: string }
  | { status: 'failed'; reason: string; statusCode?: number };

export interface PushProvider {
  readonly channel: PushChannel;
  isConfigured(): boolean;
  send(device: PushDevice, message: PushMessage): Promise<PushResult>;
}
