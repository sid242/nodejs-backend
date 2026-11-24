import { randomBytes } from 'node:crypto';

import { redis } from '@/config/redis';
import { AppError } from '@/lib/errors';

import { validateReturnTo } from './sso.security';

export interface SsoStatePayload {
  tenantId: string;
  nonce: string;
  requestId?: string; // SAML AuthnRequest ID
  codeVerifier?: string; // OIDC PKCE verifier
  returnTo: string;
  host: string;
  providerType: 'SAML' | 'OIDC';
  createdAt: number;
}

const SSO_STATE_PREFIX = 'sso:state:';
const SAML_ASSERTION_PREFIX = 'saml:assertion:';
const DEFAULT_STATE_TTL_SECONDS = 600; // 10 minutes

/**
 * Creates a server-side state stored in Redis.
 * The returned random token is sent as RelayState / state to the IdP.
 */
export async function createSsoState(
  payload: Omit<SsoStatePayload, 'createdAt'>,
  ttlSeconds = DEFAULT_STATE_TTL_SECONDS,
): Promise<string> {
  const stateId = randomBytes(32).toString('base64url');
  const key = `${SSO_STATE_PREFIX}${stateId}`;

  const stateData: SsoStatePayload = {
    ...payload,
    returnTo: validateReturnTo(payload.returnTo),
    createdAt: Date.now(),
  };

  await redis.set(key, JSON.stringify(stateData), 'EX', ttlSeconds);
  return stateId;
}

/**
 * Atomically consumes and deletes the SSO state by state ID.
 * Ensures state is single-use and resistant to race conditions / replay.
 */
export async function consumeSsoState(stateId?: string | null): Promise<SsoStatePayload | null> {
  if (!stateId || typeof stateId !== 'string') {
    return null;
  }

  const key = `${SSO_STATE_PREFIX}${stateId.trim()}`;

  // Atomic GET and DELETE using Lua script to guarantee compatibility across Redis versions
  const luaScript = `
    local val = redis.call('get', KEYS[1])
    if val then
      redis.call('del', KEYS[1])
    end
    return val
  `;

  try {
    const raw = (await redis.eval(luaScript, 1, key)) as string | null;
    if (!raw) return null;
    return JSON.parse(raw) as SsoStatePayload;
  } catch {
    return null;
  }
}

/**
 * Guards against SAML assertion replay attacks.
 * Stores assertion ID in Redis with NX (not exists) flag.
 * If the assertion was already processed, throws unauthorized.
 */
export async function recordSamlAssertion(assertionId: string, ttlSeconds = 300): Promise<void> {
  if (!assertionId) {
    throw AppError.unauthorized('Missing SAML Assertion ID');
  }

  const key = `${SAML_ASSERTION_PREFIX}${assertionId}`;
  // 'NX' ensures key is set only if it does not already exist
  const result = await redis.set(key, '1', 'EX', Math.max(ttlSeconds, 60), 'NX');

  if (result !== 'OK') {
    throw AppError.unauthorized('SAML assertion has already been processed (replay detected)');
  }
}
