import dns from 'node:dns/promises';
import { env } from '@/config/env';
import { AppError } from '@/lib/errors';

/**
 * Validates returnTo path to prevent open redirects.
 * Only allows relative paths starting with a single '/' (e.g., '/w/acme/dashboard').
 * Rejects protocol-relative ('//evil.com') and absolute URLs ('https://evil.com').
 */
export function validateReturnTo(returnTo?: string | null): string {
  if (!returnTo || typeof returnTo !== 'string') {
    return '/';
  }

  const trimmed = returnTo.trim();

  // Must begin with single '/' and NOT with '//' or '/\'
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }

  // Prevent backslash trickery or CR/LF header injection
  if (/[\r\n\t\0\\]/.test(trimmed)) {
    return '/';
  }

  // Attempt URL parse relative to a dummy base to verify no scheme override
  try {
    const parsed = new URL(trimmed, 'https://dummy.local');
    if (parsed.origin !== 'https://dummy.local') {
      return '/';
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

/**
 * Checks whether an IPv4 address is in a private, loopback, or link-local range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP treated as unsafe
  }

  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (RFC1918 Private)
  if (a === 10) return true;
  // 172.16.0.0/12 (RFC1918 Private: 172.16.x.x - 172.31.x.x)
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (RFC1918 Private)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata service e.g. 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 224.0.0.0/4 (Multicast) or 240.0.0.0/4 (Reserved)
  if (a >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is loopback, unique local, or link-local.
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 or ::
  if (normalized === '::1' || normalized === '::') return true;

  // fc00::/7 (Unique Local Address)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // fe80::/10 (Link-Local)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.includes('::ffff:')) {
    const ipv4Part = normalized.split('::ffff:')[1];
    if (ipv4Part && ipv4Part.includes('.')) {
      return isPrivateIPv4(ipv4Part);
    }
    return true;
  }

  return false;
}

/**
 * SSRF Guard: Asserts that a target URL is safe to fetch over HTTP(S).
 * Rejects non-http(s) schemes, private networks, localhost, link-local, and AWS/GCP/Azure metadata services.
 */
export async function assertSafeUrl(
  urlString: string,
  options?: { allowHttpInDev?: boolean },
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw AppError.badRequest('Invalid URL format');
  }

  const isDevOrTest = env.NODE_ENV !== 'production';
  const allowHttp = options?.allowHttpInDev && isDevOrTest;

  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw AppError.badRequest(`Insecure URL protocol '${url.protocol}'. HTTPS is required.`);
  }

  const hostname = url.hostname.toLowerCase();

  // Check common localhost aliases immediately
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    if (!allowHttp) {
      throw AppError.badRequest('Requests to localhost or private network are forbidden (SSRF protection)');
    }
  }

  // Resolve DNS to verify IP addresses
  try {
    const lookupResults = await dns.lookup(hostname, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      throw AppError.badRequest(`Could not resolve hostname '${hostname}'`);
    }

    for (const record of lookupResults) {
      const isDangerous =
        record.family === 4
          ? isPrivateIPv4(record.address)
          : isPrivateIPv6(record.address);

      if (isDangerous && !allowHttp) {
        throw AppError.badRequest(
          `URL resolves to a restricted or private IP address (${record.address}). SSRF blocked.`,
        );
      }
    }
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw AppError.badRequest(`DNS resolution failed for host '${hostname}': ${err?.message ?? 'Unknown error'}`);
  }

  return url;
}

/**
 * Safe fetch wrapper that guards against SSRF, restricts protocols, and disables automatic unsafe redirects.
 */
export async function safeFetch(
  urlString: string,
  init?: RequestInit,
  options?: { allowHttpInDev?: boolean },
): Promise<Response> {
  await assertSafeUrl(urlString, options);

  const controller = new AbortController();
  const timeoutMs = 10000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlString, {
      ...init,
      signal: controller.signal,
      redirect: 'manual', // Do not automatically follow redirects to avoid redirect-based SSRF bypass
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}
