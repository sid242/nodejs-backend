import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { parseList } from '@/lib/utils';
import { isReservedSlug } from '@/modules/tenants/tenants.dto';

const REDIS_CORS_SET = 'cors:custom-domains';

// 60-second in-memory memo of verified custom domains
let cachedCustomDomains: Set<string> = new Set();
let lastCacheSync = 0;
const CACHE_TTL_MS = 60_000;

export async function getVerifiedCustomDomains(): Promise<Set<string>> {
  const now = Date.now();
  if (now - lastCacheSync < CACHE_TTL_MS && cachedCustomDomains.size > 0) {
    return cachedCustomDomains;
  }

  try {
    const domains = await redis.smembers(REDIS_CORS_SET);
    cachedCustomDomains = new Set((domains ?? []).map((d) => d.toLowerCase().trim()));
    lastCacheSync = now;
  } catch {
    /* fallback to cachedCustomDomains */
  }

  return cachedCustomDomains;
}

export async function addCorsCustomDomain(domain: string): Promise<void> {
  const clean = domain.toLowerCase().trim();
  cachedCustomDomains.add(clean);
  try {
    await redis.sadd(REDIS_CORS_SET, clean);
  } catch {
    /* ignore redis error */
  }
}

export async function removeCorsCustomDomain(domain: string): Promise<void> {
  const clean = domain.toLowerCase().trim();
  cachedCustomDomains.delete(clean);
  try {
    await redis.srem(REDIS_CORS_SET, clean);
  } catch {
    /* ignore redis error */
  }
}

export async function isOriginAllowed(origin: string | undefined): Promise<boolean> {
  if (!origin) return true;

  // 1. Static allowed CORS origins
  const staticOrigins = parseList(env.CORS_ORIGINS);
  if (staticOrigins.includes(origin)) {
    return true;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(origin);
  } catch {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const rawBaseDomain = env.APP_BASE_DOMAIN.toLowerCase().split(':')[0] ?? 'localhost';

  // 2. Platform host match
  const platformHostname = env.PLATFORM_HOST.toLowerCase().split(':')[0] ?? rawBaseDomain;
  if (hostname === rawBaseDomain || hostname === platformHostname) {
    return true;
  }

  // 3. Subdomain match on APP_BASE_DOMAIN (e.g. acme.example.com or acme.localhost)
  if (hostname.endsWith(`.${rawBaseDomain}`)) {
    const label = hostname.slice(0, hostname.length - (rawBaseDomain.length + 1));
    if (label && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && !isReservedSlug(label)) {
      return true;
    }
  }

  if (rawBaseDomain === 'localhost' || hostname.endsWith('.localhost')) {
    const parts = hostname.split('.');
    if (parts.length === 2 && parts[1] === 'localhost') {
      const label = parts[0];
      if (label && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && !isReservedSlug(label)) {
        return true;
      }
    }
  }

  // 4. Exact verified custom domains from Redis
  const verifiedDomains = await getVerifiedCustomDomains();
  if (verifiedDomains.has(hostname)) {
    return true;
  }

  return false;
}

export function dynamicCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  void isOriginAllowed(origin)
    .then((allowed) => callback(null, allowed))
    .catch((err) => callback(err, false));
}

