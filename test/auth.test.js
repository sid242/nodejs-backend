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

  const verified = jwt.verify(token, TEST_ACCESS_SECRET);
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
    (err) => err.name === 'TokenExpiredError',
  );
});

test('JWT refresh token contains jti and subject', () => {
  const token = jwt.sign({}, TEST_REFRESH_SECRET, {
    subject: 'user-456',
    jwtid: 'random-jti-uuid',
    expiresIn: 604800,
  });

  const verified = jwt.verify(token, TEST_REFRESH_SECRET);
  assert.equal(verified.sub, 'user-456');
  assert.equal(verified.jti, 'random-jti-uuid');
});
