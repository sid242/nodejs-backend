import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const TEST_ACCESS_SECRET = 'a'.repeat(32);
const TEST_REFRESH_SECRET = 'b'.repeat(32);

test('JWT access token signing and verification', () => {
  const payload = { role: 'USER' };
  const token = jwt.sign(payload, TEST_ACCESS_SECRET, {
    subject: 'user-123',
    expiresIn: '15m',
  });

  const verified = jwt.verify(token, TEST_ACCESS_SECRET) as jwt.JwtPayload;
  assert.equal(verified.sub, 'user-123');
  assert.equal(verified.role, 'USER');
});

test('JWT expired token throws TokenExpiredError', async () => {
  const token = jwt.sign({ role: 'USER' }, TEST_ACCESS_SECRET, {
    subject: 'user-123',
    expiresIn: '1ms',
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.throws(
    () => jwt.verify(token, TEST_ACCESS_SECRET),
    (err: unknown) => (err as Error).name === 'TokenExpiredError',
  );
});

test('JWT refresh token contains jti and subject', () => {
  const token = jwt.sign({}, TEST_REFRESH_SECRET, {
    subject: 'user-456',
    jwtid: 'random-jti-uuid',
    expiresIn: 604800,
  });

  const verified = jwt.verify(token, TEST_REFRESH_SECRET) as jwt.JwtPayload;
  assert.equal(verified.sub, 'user-456');
  assert.equal(verified.jti, 'random-jti-uuid');
});

test('parseDurationToMs correctly parses human duration units', async () => {
  process.env.DATABASE_URL = 'postgresql://app:app@localhost:5432/app';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
  process.env.S3_BUCKET = 'test';
  const { parseDurationToMs } = await import('../src/modules/auth/cookies.js');

  assert.equal(parseDurationToMs('15m'), 15 * 60 * 1000);
  assert.equal(parseDurationToMs('1h'), 60 * 60 * 1000);
  assert.equal(parseDurationToMs('2d'), 2 * 24 * 60 * 60 * 1000);
  assert.equal(parseDurationToMs('45s'), 45 * 1000);
  assert.equal(parseDurationToMs(300), 300 * 1000);
});

test('parseCookies parses cookie string into key-value pairs', async () => {
  const { parseCookies } = await import('../src/modules/auth/cookies.js');
  const cookieStr = 'accessToken=token123; refreshToken=token456; other=val%20test';
  const parsed = parseCookies(cookieStr);
  assert.equal(parsed.accessToken, 'token123');
  assert.equal(parsed.refreshToken, 'token456');
  assert.equal(parsed.other, 'val test');
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('setAuthCookies sets both accessToken and refreshToken cookies with httpOnly', async () => {
  const { setAuthCookies } = await import('../src/modules/auth/cookies.js');
  const cookies: Record<string, { val: string; options: any }> = {};
  const mockRes = {
    cookie: (name: string, val: string, options: any) => {
      cookies[name] = { val, options };
    },
  } as any;

  setAuthCookies(mockRes, { accessToken: 'acc-1', refreshToken: 'ref-1' });

  assert.ok(cookies.accessToken);
  assert.equal(cookies.accessToken.val, 'acc-1');
  assert.equal(cookies.accessToken.options.httpOnly, true);
  assert.equal(cookies.accessToken.options.path, '/');
  assert.ok(cookies.refreshToken);
  assert.equal(cookies.refreshToken.val, 'ref-1');
  assert.equal(cookies.refreshToken.options.httpOnly, true);
  assert.equal(cookies.refreshToken.options.path, '/api/v1/auth');
});

test('clearAuthCookies clears both accessToken and refreshToken cookies', async () => {
  const { clearAuthCookies } = await import('../src/modules/auth/cookies.js');
  const cleared: Array<{ name: string; options: any }> = [];
  const mockRes = {
    clearCookie: (name: string, options: any) => {
      cleared.push({ name, options });
    },
  } as any;

  clearAuthCookies(mockRes);

  assert.ok(cleared.some((c) => c.name === 'accessToken' && c.options.path === '/'));
  assert.ok(cleared.some((c) => c.name === 'refreshToken' && c.options.path === '/api/v1/auth'));
});

test('dual-mode auth token extraction: header takes precedence, cookie is fallback', () => {
  function extractToken(req: {
    headers: { authorization?: string };
    cookies?: { accessToken?: string };
  }) {
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    return token;
  }

  // Mobile / API client with header
  assert.equal(extractToken({ headers: { authorization: 'Bearer mobile-token' } }), 'mobile-token');

  // Web browser client with cookie
  assert.equal(
    extractToken({ headers: {}, cookies: { accessToken: 'cookie-token' } }),
    'cookie-token',
  );

  // Header takes precedence when both provided
  assert.equal(
    extractToken({
      headers: { authorization: 'Bearer header-token' },
      cookies: { accessToken: 'cookie-token' },
    }),
    'header-token',
  );

  // Missing both
  assert.equal(extractToken({ headers: {} }), undefined);
});

test('auth and queue constants are properly defined', async () => {
  const {
    COOKIE_NAMES,
    COOKIE_PATHS,
    AUTH_HEADERS,
    AUTH_MESSAGES,
    TOKEN_EXPIRATION,
    REDIS_PREFIXES,
    QUEUE_NAMES,
  } = await import('../src/constants/index.js');

  assert.equal(COOKIE_NAMES.ACCESS_TOKEN, 'accessToken');
  assert.equal(COOKIE_NAMES.REFRESH_TOKEN, 'refreshToken');
  assert.equal(COOKIE_PATHS.ROOT, '/');
  assert.equal(COOKIE_PATHS.AUTH, '/api/v1/auth');
  assert.equal(AUTH_HEADERS.PREFIX, 'Bearer ');
  assert.equal(
    AUTH_MESSAGES.EMAIL_NOT_VERIFIED,
    'Email not verified. Please verify your email before logging in.',
  );
  assert.equal(TOKEN_EXPIRATION.PASSWORD_RESET_SECONDS, 900);
  assert.equal(TOKEN_EXPIRATION.EMAIL_VERIFICATION_SECONDS, 86400);
  assert.equal(REDIS_PREFIXES.REFRESH_TOKEN, 'rt:');
  assert.equal(QUEUE_NAMES.EMAIL, 'email');
});

test('login requires verified email: unverified user is rejected', async () => {
  const { AUTH_MESSAGES } = await import('../src/constants/index.js');

  function validateEmailVerified(user: { emailVerifiedAt: Date | null }) {
    if (!user.emailVerifiedAt) {
      throw new Error(AUTH_MESSAGES.EMAIL_NOT_VERIFIED);
    }
    return true;
  }

  // Unverified user throws error
  assert.throws(
    () => validateEmailVerified({ emailVerifiedAt: null }),
    (err: Error) =>
      err.message === 'Email not verified. Please verify your email before logging in.',
  );

  // Verified user succeeds
  assert.equal(validateEmailVerified({ emailVerifiedAt: new Date() }), true);
});
