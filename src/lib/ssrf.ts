import dns from 'node:dns/promises';
import net from 'node:net';

import { AppError } from '@/lib/errors';

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8 (current network)
  if (b0 === 0) return true;
  // 10.0.0.0/8 (private)
  if (b0 === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (b0 === 127) return true;
  // 169.254.0.0/16 (link-local & cloud metadata)
  if (b0 === 169 && b1 === 254) return true;
  // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 !== undefined && b1 >= 16 && b1 <= 31) return true;
  // 192.168.0.0/16 (private)
  if (b0 === 192 && b1 === 168) return true;
  // 224.0.0.0/4 (multicast: 224.0.0.0 - 239.255.255.255)
  if (b0 !== undefined && b0 >= 224 && b0 <= 239) return true;
  // 240.0.0.0/4 (reserved/future use)
  if (b0 !== undefined && b0 >= 240) return true;

  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 loopback
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  // :: unspecified
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
  // fc00::/7 (unique local: fc00:: - fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // fe80::/10 (link-local: fe80:: - febf::)
  if (/^fe[89ab]/i.test(normalized)) return true;

  return false;
}

export function isDisallowedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // Not a valid IP
}

export interface ValidateWebhookUrlOptions {
  allowLocalhostInDev?: boolean;
}

/**
 * Validates a destination URL against SSRF vulnerabilities.
 * Enforces HTTPS, resolves DNS, and blocks local/private/cloud-metadata addresses.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  options: ValidateWebhookUrlOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw AppError.badRequest('Invalid webhook destination URL format');
  }

  const isLocalDev =
    process.env.NODE_ENV !== 'production' && Boolean(options.allowLocalhostInDev);

  if (parsed.protocol !== 'https:') {
    if (!isLocalDev || parsed.protocol !== 'http:') {
      throw AppError.badRequest('Webhook destination URL must use HTTPS');
    }
  }

  if (parsed.username || parsed.password) {
    throw AppError.badRequest('Webhook URL must not contain embedded user credentials');
  }

  const hostname = parsed.hostname;

  // If localhost is allowed for testing
  if (isLocalDev && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return parsed;
  }

  // Check if hostname is a raw IP literal
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw AppError.badRequest(
        'Webhook destination points to a restricted local, private, or metadata address',
      );
    }
    return parsed;
  }

  // Resolve DNS to verify all destination IPs
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw AppError.badRequest(`Could not resolve hostname "${hostname}"`);
    }

    for (const entry of addresses) {
      if (isDisallowedIp(entry.address)) {
        throw AppError.badRequest(
          `Webhook hostname "${hostname}" resolves to a restricted internal address (${entry.address})`,
        );
      }
    }
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw AppError.badRequest(`DNS resolution failed for hostname "${hostname}"`);
  }

  return parsed;
}
