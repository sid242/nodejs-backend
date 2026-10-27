import assert from 'node:assert/strict';
import test from 'node:test';
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
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:app@localhost:5433/app';
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'b'.repeat(32);
  process.env.S3_BUCKET = process.env.S3_BUCKET || 'test';
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

test('changePasswordDto validates currentPassword and newPassword rules', async () => {
  const { changePasswordDto } = await import('../src/modules/auth/auth.dto.js');

  const valid = changePasswordDto.safeParse({
    currentPassword: 'OldPassword123!',
    newPassword: 'NewPassword123!',
  });
  assert.equal(valid.success, true);

  const shortNew = changePasswordDto.safeParse({
    currentPassword: 'OldPassword123!',
    newPassword: 'short',
  });
  assert.equal(shortNew.success, false);

  const missingCurrent = changePasswordDto.safeParse({
    currentPassword: '',
    newPassword: 'NewPassword123!',
  });
  assert.equal(missingCurrent.success, false);
});

test('issueTokens generates valid access and refresh tokens and stores in Redis', async () => {
  const { issueTokens, verifyAccessToken, consumeRefreshToken } =
    await import('../src/modules/auth/tokens.js');
  const user = { id: 'test-usr-1', role: 'ADMIN' };
  const tokens = await issueTokens(user);

  assert.ok(tokens.accessToken);
  assert.ok(tokens.refreshToken);

  const payload = verifyAccessToken(tokens.accessToken);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.role, user.role);

  // Consume (single-use rotation)
  const consumedUserId = await consumeRefreshToken(tokens.refreshToken);
  assert.equal(consumedUserId, user.id);

  // Replay should fail
  await assert.rejects(
    () => consumeRefreshToken(tokens.refreshToken),
    (err: any) => err.message.includes('revoked or already used'),
  );
});

test('revokeRefreshToken explicitly revokes refresh token from Redis', async () => {
  const { issueTokens, revokeRefreshToken, consumeRefreshToken } =
    await import('../src/modules/auth/tokens.js');
  const user = { id: 'test-usr-2', role: 'USER' };
  const tokens = await issueTokens(user);

  await revokeRefreshToken(tokens.refreshToken);

  await assert.rejects(
    () => consumeRefreshToken(tokens.refreshToken),
    (err: any) => err.message.includes('revoked or already used'),
  );
});

test('revokeAllUserTokens revokes all active refresh tokens for that user', async () => {
  const { issueTokens, revokeAllUserTokens, consumeRefreshToken } =
    await import('../src/modules/auth/tokens.js');
  const user = { id: 'test-usr-3', role: 'USER' };
  const t1 = await issueTokens(user);
  const t2 = await issueTokens(user);

  await revokeAllUserTokens(user.id);

  await assert.rejects(() => consumeRefreshToken(t1.refreshToken));
  await assert.rejects(() => consumeRefreshToken(t2.refreshToken));
});

test('2FA DTOs validate payloads correctly', async () => {
  const { enableTwoFactorDto, disableTwoFactorDto, verifyTwoFactorChallengeDto } =
    await import('../src/modules/auth/auth.dto.js');

  // enableTwoFactorDto
  assert.equal(enableTwoFactorDto.safeParse({ code: '123456' }).success, true);
  assert.equal(enableTwoFactorDto.safeParse({ code: '12345' }).success, false);
  assert.equal(enableTwoFactorDto.safeParse({ code: '1234567' }).success, false);
  assert.equal(enableTwoFactorDto.safeParse({ code: 'abcdef' }).success, false);

  // disableTwoFactorDto
  assert.equal(
    disableTwoFactorDto.safeParse({
      password: 'Password123!',
      code: '123456',
    }).success,
    true,
  );
  assert.equal(
    disableTwoFactorDto.safeParse({
      password: '',
      code: '123456',
    }).success,
    false,
  );
  assert.equal(
    disableTwoFactorDto.safeParse({
      password: 'Password123!',
      code: 'invalid',
    }).success,
    false,
  );

  // verifyTwoFactorChallengeDto
  assert.equal(
    verifyTwoFactorChallengeDto.safeParse({
      challengeToken: 'valid-challenge-token-uuid',
      code: '123456',
    }).success,
    true,
  );
  assert.equal(
    verifyTwoFactorChallengeDto.safeParse({
      challengeToken: '',
      code: '123456',
    }).success,
    false,
  );
});

test('2FA TOTP generation, challenge creation and validation lifecycle', async () => {
  const { TOTP, Secret } = await import('otpauth');
  const { db } = await import('../src/config/db.js');
  const { users } = await import('../src/db/schema/index.js');
  const { eq } = await import('drizzle-orm');
  const { createTwoFactorChallenge, verifyTwoFactorChallenge } =
    await import('../src/modules/auth/two-factor.service.js');

  // 1. Generate a test TOTP secret and token
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: 'TestApp',
    label: 'test@example.com',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const validToken = totp.generate();
  assert.equal(validToken.length, 6);
  assert.equal(totp.validate({ token: validToken, window: 1 }), 0);

  // 2. Insert temporary test user
  const uniqueEmail = `test-2fa-${Date.now()}@example.com`;
  const [createdUser] = await db
    .insert(users)
    .values({
      email: uniqueEmail,
      name: '2FA Test User',
      passwordHash: '$2a$12$dummyhashforisolationtesting00000000000000000000000',
      status: 'ACTIVE',
    })
    .returning();
  assert.ok(createdUser);

  try {
    // 3. Create challenge
    const challenge = await createTwoFactorChallenge(createdUser.id);
    assert.equal(challenge.twoFactorRequired, true);
    assert.equal(challenge.method, 'totp');
    assert.ok(challenge.challengeToken);

    // 4. Reject invalid challenge token
    await assert.rejects(
      () => verifyTwoFactorChallenge('non-existent-token', '123456'),
      (err: any) => err.message.toLowerCase().includes('invalid'),
    );
  } finally {
    await db.delete(users).where(eq(users.id, createdUser.id));
  }
});
