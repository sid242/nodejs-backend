import type { CookieOptions, Response } from 'express';

import { env } from '@/config/env.js';
import { ACCESS_TOKEN_COOKIE, COOKIE_PATHS, REFRESH_TOKEN_COOKIE } from '@/constants/index.js';

export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE };

/** Parse human durations (e.g. '15m', '1h', '7d') or numeric seconds to milliseconds. */
export function parseDurationToMs(duration: string | number): number {
  if (typeof duration === 'number') return duration * 1000;
  const match = duration.trim().match(/^(\d+)([smhd])?$/i);
  if (!match || !match[1]) return 15 * 60 * 1000;
  const val = parseInt(match[1], 10);
  const unit = (match[2] ?? 's').toLowerCase();
  switch (unit) {
    case 's':
      return val * 1000;
    case 'm':
      return val * 60 * 1000;
    case 'h':
      return val * 60 * 60 * 1000;
    case 'd':
      return val * 24 * 60 * 60 * 1000;
    default:
      return val * 1000;
  }
}

export const getAccessTokenCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: COOKIE_PATHS.ROOT,
  maxAge: parseDurationToMs(env.JWT_ACCESS_TTL),
});

export const getRefreshTokenCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: COOKIE_PATHS.AUTH,
  maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
});

/** Sets HttpOnly auth cookies on the response for web browser clients. */
export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, getAccessTokenCookieOptions());
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, getRefreshTokenCookieOptions());
}

/** Clears HttpOnly auth cookies across both root and auth paths. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATHS.ROOT,
  });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATHS.AUTH,
  });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATHS.ROOT,
  });
}

/** Utility to parse raw Cookie header string into key-value pairs (used by WebSockets handshake). */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce<Record<string, string>>((acc, cookieStr) => {
    const idx = cookieStr.indexOf('=');
    if (idx === -1) return acc;
    const key = cookieStr.slice(0, idx).trim();
    const val = cookieStr.slice(idx + 1).trim();
    if (key) {
      try {
        acc[key] = decodeURIComponent(val);
      } catch {
        acc[key] = val;
      }
    }
    return acc;
  }, {});
}
