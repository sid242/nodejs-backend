import { isIP } from 'node:net';

import { AppError } from '@/lib/errors';

export const ALLOWED_PUSH_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
]);

export const ALLOWED_PUSH_SUFFIX_HOSTS = ['.push.apple.com', '.notify.windows.com'] as const;

export function isAllowedPushEndpoint(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) return false;
  if (isIP(host) !== 0) return false;

  if (ALLOWED_PUSH_EXACT_HOSTS.has(host)) return true;
  return ALLOWED_PUSH_SUFFIX_HOSTS.some(
    (suffix) => host.endsWith(suffix) && host.length > suffix.length,
  );
}

export function assertValidPushEndpoint(endpoint: string): string {
  if (!isAllowedPushEndpoint(endpoint)) {
    throw AppError.badRequest(
      'Unsupported push endpoint host. Only trusted HTTPS Web Push services are permitted.',
    );
  }
  return endpoint;
}
