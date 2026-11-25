import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import { z } from 'zod';

import { env } from '@/config/env';
import { ACCESS_TOKEN_COOKIE, PLATFORM_STAFF_TOKEN_COOKIE } from '@/constants/index';
import { parseCookies } from '@/modules/auth/cookies';
import { verifyAccessToken, verifySupportToken } from '@/modules/auth/tokens';
import * as platformRepo from '@/modules/platform/platform.repository';
import { loadActiveSupportAccess } from '@/modules/platform/support-access';
import * as tenantsRepo from '@/modules/tenants/tenants.repository';

import { consumeRateLimit } from './rate-limit';
import { getSocketAuthState } from './types';

const workspaceSlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9-]+$/);

const handshakeScopeSchema = z.enum(['tenant', 'platform']).optional();

export function verifyPlatformStaffSocketToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.JWT_PLATFORM_SECRET, {
      audience: 'platform-api',
      algorithms: ['HS256'],
    }) as JwtPayload & { typ?: string };
    if (decoded?.typ !== 'STAFF' || !decoded.sub) return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

function extractHandshakeToken(socket: Socket, requestedScope?: 'tenant' | 'platform'): string {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }

  const cookies = socket.handshake.headers.cookie
    ? parseCookies(socket.handshake.headers.cookie)
    : {};

  const cookieToken =
    requestedScope === 'platform'
      ? cookies[PLATFORM_STAFF_TOKEN_COOKIE]
      : (cookies[ACCESS_TOKEN_COOKIE] ?? cookies[PLATFORM_STAFF_TOKEN_COOKIE]);

  if (!cookieToken) throw new Error('unauthorized');
  return cookieToken;
}

async function tryAuthenticateStaff(socket: Socket, token: string): Promise<boolean> {
  const staffId = verifyPlatformStaffSocketToken(token);
  if (!staffId) return false;

  const allowed = await consumeRateLimit(
    `connect:staff:${staffId}`,
    env.SOCKET_CONNECTIONS_PER_MINUTE,
    60_000,
  );
  if (!allowed) throw new Error('rate_limited');

  const staff = await platformRepo.findStaffById(staffId);
  if (!staff || staff.status !== 'ACTIVE') throw new Error('unauthorized');

  const state = getSocketAuthState(socket);
  state.actorType = 'STAFF';
  state.staffId = staff.id;
  state.user = { id: staff.id };
  return true;
}

async function tryAuthenticateSupportSession(
  socket: Socket,
  token: string,
  requestedSlug?: string,
): Promise<boolean> {
  try {
    const supportPayload = verifySupportToken(token);
    const { session, tenant } = await loadActiveSupportAccess(supportPayload);
    if (requestedSlug && requestedSlug !== tenant.slug) throw new Error('unauthorized');

    const state = getSocketAuthState(socket);
    state.actorType = 'SUPPORT';
    state.workspaceTenantId = tenant.id;
    state.workspaceTenant = {
      id: tenant.id,
      databaseMode: tenant.databaseMode,
      databaseKey: tenant.databaseKey,
      databaseSecretRef: tenant.databaseSecretRef,
    };
    state.isSupportSession = true;
    state.supportSession = session;
    state.supportClaims = supportPayload;
    state.user = { id: session.staffId };
    return true;
  } catch {
    return false;
  }
}

async function tryAuthenticateTenantUser(
  socket: Socket,
  token: string,
  requestedSlug?: string,
): Promise<boolean> {
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return false;
  }

  if (payload?.typ !== 'USER' || !payload.sub) return false;

  const allowed = await consumeRateLimit(
    `connect:${payload.sub}`,
    env.SOCKET_CONNECTIONS_PER_MINUTE,
    60_000,
  );
  if (!allowed) throw new Error('rate_limited');

  const state = getSocketAuthState(socket);
  if (requestedSlug) {
    const tenant = await tenantsRepo.findTenantBySlug(requestedSlug);
    if (!tenant || tenant.deletedAt || !['ACTIVE', 'TRIALING'].includes(tenant.status)) {
      throw new Error('unauthorized');
    }
    const member = await tenantsRepo.findTenantMember(tenant.id, payload.sub);
    if (!member || member.status !== 'ACTIVE') throw new Error('unauthorized');
    state.workspaceTenantId = tenant.id;
    state.workspaceTenant = {
      id: tenant.id,
      databaseMode: tenant.databaseMode,
      databaseKey: tenant.databaseKey,
      databaseSecretRef: tenant.databaseSecretRef,
    };
  }

  state.actorType = 'USER';
  state.user = { id: payload.sub };
  return true;
}

/**
 * Authenticates Socket.IO handshakes for tenant users, platform staff, and support sessions.
 */
export function authenticateSocket(socket: Socket, next: (err?: Error) => void): void {
  void (async () => {
    const requestedScope = handshakeScopeSchema.parse(socket.handshake.auth?.scope);
    const token = extractHandshakeToken(socket, requestedScope);

    if (requestedScope === 'platform') {
      const ok = await tryAuthenticateStaff(socket, token);
      if (!ok) throw new Error('unauthorized');
      return next();
    }

    const requestedSlug = workspaceSlugSchema
      .optional()
      .parse(socket.handshake.auth?.workspaceSlug);

    if (await tryAuthenticateSupportSession(socket, token, requestedSlug)) {
      return next();
    }
    if (await tryAuthenticateTenantUser(socket, token, requestedSlug)) {
      return next();
    }
    if (await tryAuthenticateStaff(socket, token)) {
      return next();
    }

    throw new Error('unauthorized');
  })().catch((err: unknown) => {
    const msg =
      err instanceof Error && err.message === 'rate_limited' ? 'rate_limited' : 'unauthorized';
    next(new Error(msg));
  });
}
