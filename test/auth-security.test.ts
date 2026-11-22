import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';

import { loginDto, registerDto, verifyTwoFactorChallengeDto } from '../src/modules/auth/auth.dto';
import { hashToken } from '../src/modules/auth/verification.repository';

test('Sign-in trims email without applying the registration password minimum', () => {
  assert.deepEqual(loginDto.parse({ email: ' member@example.com ', password: 'short' }), {
    email: 'member@example.com',
    password: 'short',
  });
});

test('MFA accepts authenticator and recovery code formats', () => {
  const challengeToken = 'demo-challenge';
  for (const code of ['123456', 'a1b2c3d4e5']) {
    assert.equal(verifyTwoFactorChallengeDto.safeParse({ challengeToken, code }).success, true);
  }
  assert.equal(
    verifyTwoFactorChallengeDto.safeParse({ challengeToken, code: '1234567' }).success,
    false,
  );
});

test('Registration DTO validates required firstName and lastName', () => {
  const result = registerDto.safeParse({
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    password: 'password123',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.firstName, 'Alice');
    assert.equal(result.data.lastName, 'Smith');
  }
});

test('Registration DTO rejects when lastName is missing', () => {
  const result = registerDto.safeParse({
    firstName: 'Alice',
    email: 'alice@example.com',
    password: 'password123',
  });
  assert.equal(result.success, false);
});

test('Registration DTO rejects when firstName is missing', () => {
  const result = registerDto.safeParse({
    lastName: 'Smith',
    email: 'charlie@example.com',
    password: 'password123',
  });
  assert.equal(result.success, false);
});

test('hashToken produces consistent SHA-256 hex string', () => {
  const token = 'sample-refresh-token-12345';
  const hash1 = hashToken(token);
  const hash2 = hashToken(token);

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test('Lockout exponential backoff calculation', () => {
  // Test the backoff equation: 15 * 2^min(attempts - 5, 4)
  const calculateLockMins = (attempts: number) => {
    if (attempts < 5) return 0;
    return 15 * Math.pow(2, Math.min(attempts - 5, 4));
  };

  assert.equal(calculateLockMins(4), 0);
  assert.equal(calculateLockMins(5), 15); // 5th failure -> 15 mins
  assert.equal(calculateLockMins(6), 30); // 6th failure -> 30 mins
  assert.equal(calculateLockMins(7), 60); // 7th failure -> 60 mins
  assert.equal(calculateLockMins(8), 120); // 8th failure -> 120 mins
  assert.equal(calculateLockMins(9), 240); // 9th failure -> 240 mins (capped)
  assert.equal(calculateLockMins(15), 240); // 15th failure -> 240 mins (capped)
});

test('2FA recovery code hashing and single use consumption simulation', async () => {
  const rawCodes = ['A1B2C3D4E5', 'F6G7H8I9J0', 'K1L2M3N4O5'];
  const hashedCodes = await Promise.all(rawCodes.map((code) => bcrypt.hash(code, 10)));

  assert.equal(hashedCodes.length, 3);

  // User enters second code in lowercase
  const enteredCode = 'f6g7h8i9j0';
  let matchedIndex = -1;

  for (let i = 0; i < hashedCodes.length; i++) {
    const matches = await bcrypt.compare(enteredCode.toUpperCase(), hashedCodes[i]!);
    if (matches) {
      matchedIndex = i;
      break;
    }
  }

  assert.equal(matchedIndex, 1);

  // Consume code
  const remainingCodes = [...hashedCodes];
  remainingCodes.splice(matchedIndex, 1);
  assert.equal(remainingCodes.length, 2);

  // Second attempt with same code should fail
  let secondAttemptMatched = false;
  for (let i = 0; i < remainingCodes.length; i++) {
    const matches = await bcrypt.compare(enteredCode.toUpperCase(), remainingCodes[i]!);
    if (matches) {
      secondAttemptMatched = true;
      break;
    }
  }
  assert.equal(secondAttemptMatched, false);
});
