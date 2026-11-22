import assert from 'node:assert/strict';
import test from 'node:test';

import { decrypt, encrypt } from '@/lib/crypto';

test('AES-256-GCM encryption & decryption roundtrip succeeds', () => {
  const secretText = 'SuperSecretSmtpPassword123!@#';
  const encrypted = encrypt(secretText);

  assert.notEqual(encrypted, secretText);
  assert.equal(typeof encrypted, 'string');
  assert.match(encrypted, /^v1:[^:]+:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/);

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, secretText);
});

test('encrypt returns empty string for falsy input', () => {
  assert.equal(encrypt(''), '');
  assert.equal(decrypt(''), '');
});

test('decrypt rejects tampered ciphertext or altered auth tag', () => {
  const encrypted = encrypt('my-secret-password');
  const parts = encrypted.split(':');
  for (const index of [3, 4]) {
    const tampered = [...parts];
    const part = tampered[index];
    assert.ok(part);
    tampered[index] = part.slice(0, -1) + (part.endsWith('a') ? 'b' : 'a');
    assert.throws(() => decrypt(tampered.join(':')));
  }
});

test('decrypt rejects invalid string formats', () => {
  assert.throws(() => decrypt('not-valid-format'));
  assert.throws(() => decrypt('part1:part2'));
});
