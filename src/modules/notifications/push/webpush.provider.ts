import * as webPush from 'web-push';

import { env } from '@/config/env';
import { logger } from '@/config/logger';

import { isAllowedPushEndpoint } from './push.security';
import type { PushDevice, PushMessage, PushProvider, PushResult } from './push.types';

export interface WebPushClient {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: webPush.PushSubscription,
    payload?: string | Buffer | null,
    options?: webPush.RequestOptions,
  ): Promise<{ statusCode: number; headers?: Record<string, string | string[] | undefined> }>;
}

const MAX_PAYLOAD_BYTES = 3800; // Leave safe margin under the 4096-byte Web Push limit

let configuredKeyPair: string | null = null;
let warnedMissingKeys = false;

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? env.VAPID_PUBLIC_KEY : null;
}

export function isWebPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function warnIfWebPushUnconfigured(): void {
  if (isWebPushConfigured() || warnedMissingKeys) return;
  warnedMissingKeys = true;
  logger.warn(
    'Web Push (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) is not configured — browser push delivery is disabled.',
  );
}

export function getTtlForCategory(category?: string): number {
  switch (category) {
    case 'SECURITY':
    case 'BILLING':
      return 4 * 3600; // 4 hours for urgent alerts
    case 'TEAM':
      return 12 * 3600; // 12 hours for chat/team collaboration
    default:
      return 24 * 3600; // 24 hours default
  }
}

export function serializePushPayload(message: PushMessage): string {
  const base = {
    notificationId: message.notificationId,
    title: message.title,
    body: message.body,
    link: message.link ?? null,
    tenantId: message.tenantId ?? null,
    tag: message.tag ?? message.notificationId,
  };

  let serialized = JSON.stringify(base);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_PAYLOAD_BYTES) {
    return serialized;
  }

  // Safely truncate body/title if serialized JSON approaches 4KB
  const trimmed = {
    ...base,
    title: base.title.slice(0, 120),
    body: base.body.slice(0, 400),
  };
  serialized = JSON.stringify(trimmed);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_PAYLOAD_BYTES) {
    return serialized;
  }

  return JSON.stringify({
    notificationId: message.notificationId,
    title: 'New notification',
    body: 'Open the app to view details.',
    link: base.link ? base.link.slice(0, 250) : null,
    tenantId: base.tenantId,
    tag: base.tag,
  });
}

function parseRetryAfterMs(
  headers?: Record<string, string | string[] | undefined>,
): number | undefined {
  if (!headers) return undefined;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (!val) return undefined;
  const seconds = Number(val);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(val);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

export function createWebPushProvider(client: WebPushClient = webPush): PushProvider {
  const ensureVapid = (): boolean => {
    const publicKey = env.VAPID_PUBLIC_KEY;
    const privateKey = env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      warnIfWebPushUnconfigured();
      return false;
    }

    const subject = env.VAPID_SUBJECT ?? 'mailto:notifications@example.com';
    const pairKey = `${subject}|${publicKey}`;
    if (configuredKeyPair !== pairKey) {
      client.setVapidDetails(subject, publicKey, privateKey);
      configuredKeyPair = pairKey;
    }
    return true;
  };

  return {
    channel: 'webpush',

    isConfigured: isWebPushConfigured,

    async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
      if (!ensureVapid()) {
        return { status: 'failed', reason: 'Web Push VAPID keys not configured' };
      }

      if (!device.endpoint || !device.p256dh || !device.auth) {
        return { status: 'gone' };
      }

      // Defense in depth: re-verify endpoint allowlist even for persisted DB rows
      if (!isAllowedPushEndpoint(device.endpoint)) {
        return { status: 'gone' };
      }

      const payload = serializePushPayload(message);
      const ttl = getTtlForCategory(message.category);

      try {
        const res = await client.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          payload,
          {
            TTL: ttl,
            urgency:
              message.category === 'SECURITY' || message.category === 'BILLING' ? 'high' : 'normal',
            topic:
              (message.tag ?? message.notificationId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) ||
              undefined,
          },
        );

        if (res.statusCode >= 200 && res.statusCode < 300) {
          return { status: 'sent' };
        }
        return { status: 'failed', statusCode: res.statusCode, reason: `HTTP ${res.statusCode}` };
      } catch (err: unknown) {
        const pushErr = err as {
          statusCode?: number;
          headers?: Record<string, string | string[] | undefined>;
          message?: string;
        };
        const code = pushErr?.statusCode;

        if (code === 404 || code === 410) {
          return { status: 'gone', statusCode: code };
        }
        if (code === 429 || (typeof code === 'number' && code >= 500)) {
          return {
            status: 'retry',
            statusCode: code,
            retryAfterMs: parseRetryAfterMs(pushErr?.headers),
            reason: pushErr?.message ?? `Push upstream returned HTTP ${code}`,
          };
        }
        if (!code) {
          // Network/transient error
          return {
            status: 'retry',
            reason: pushErr?.message ?? 'Transient network error dispatching push',
          };
        }
        return {
          status: 'failed',
          statusCode: code,
          reason: pushErr?.message ?? `Push rejected with HTTP ${code}`,
        };
      }
    },
  };
}

export const webPushProvider = createWebPushProvider();
