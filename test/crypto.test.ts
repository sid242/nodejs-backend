import assert from 'node:assert/strict';
import test from 'node:test';

import { decrypt, encrypt } from '@/lib/crypto';

test('AES-256-GCM encryption & decryption roundtrip succeeds', () => {
  const secretText = 'SuperSecretSmtpPassword123!@#';
  const encrypted = encrypt(secretText);

  assert.notEqual(encrypted, secretText);
  assert.equal(typeof encrypted, 'string');
  assert.equal(encrypted.split(':').length, 3); // iv:authTag:ciphertext

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, secretText);
});

test('encrypt returns empty string for falsy input', () => {
  assert.equal(encrypt(''), '');
  assert.equal(decrypt(''), '');
});

test('decrypt rejects tampered ciphertext or altered auth tag', () => {
  const encrypted = encrypt('my-secret-password');
  const [iv, authTag, data] = encrypted.split(':');

  // Alter the ciphertext
  const safeData = data ?? '';
  const tamperedData = safeData.slice(0, -2) + (safeData.endsWith('a') ? 'b' : 'a');
  const tampered = `${iv}:${authTag}:${tamperedData}`;

  assert.throws(() => {
    decrypt(tampered);
  });
});

test('decrypt rejects invalid string formats', () => {
  assert.throws(() => decrypt('not-valid-format'));
  assert.throws(() => decrypt('part1:part2'));
});
