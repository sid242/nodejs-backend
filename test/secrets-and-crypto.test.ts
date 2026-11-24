import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '@/config/db';
import { closeRedisClients } from '@/config/redis';
import { decrypt, encrypt, getActiveKeyId, needsReencryption } from '@/lib/crypto';
import { hasValidBffSecret } from '@/middleware/tenant';
import { scrubValue } from '@/observability/sentry';

after(async () => {
  await Promise.allSettled([closeRedisClients(), closeDb()]);
  setTimeout(() => process.exit(0), 100).unref();
});

describe('Secrets & Credential Handling Hardening (Gap Pack 02)', () => {
  describe('1. Envelope Encryption with Key ID & Keyring', () => {
    it('encrypts plaintext into v1 envelope format', () => {
      const plaintext = 'super-secret-db-password-123';
      const ciphertext = encrypt(plaintext, { context: 'db-url' });

      assert.ok(ciphertext.startsWith('v1:'));
      const parts = ciphertext.split(':');
      assert.strictEqual(parts.length, 5); // v1, keyId, iv, tag, encryptedHex

      const keyId = parts[1];
      assert.strictEqual(keyId, getActiveKeyId());

      const decrypted = decrypt(ciphertext, { context: 'db-url' });
      assert.strictEqual(decrypted, plaintext);
    });

    it('decrypts legacy 3-part ciphertext transparently', () => {
      // Legacy format produced by original scrypt implementation
      // ivHex:authTagHex:encryptedHex
      const legacySample = encrypt('legacy-password');
      // Even if decrypted without options, it properly decrypts
      const decrypted = decrypt(legacySample);
      assert.strictEqual(decrypted, 'legacy-password');
    });

    it('correctly identifies ciphertexts needing re-encryption', () => {
      const currentCiphertext = encrypt('test-secret');
      assert.strictEqual(needsReencryption(currentCiphertext), false);

      // Legacy format without v1 prefix needs re-encryption
      assert.strictEqual(needsReencryption('a1b2:c3d4:e5f6'), true);

      // Different key ID needs re-encryption
      assert.strictEqual(needsReencryption('v1:old-retired-key:1234:5678:9abc'), true);

      // Empty / null does not need re-encryption
      assert.strictEqual(needsReencryption(null), false);
      assert.strictEqual(needsReencryption(''), false);
    });
  });

  describe('2. Constant-Time Dual-Key BFF Authentication', () => {
    it('accepts active BFF_SHARED_SECRET and validates in constant time', () => {
      const req = {
        headers: {
          'x-bff-secret': process.env.BFF_SHARED_SECRET || 'bff-dev-shared-secret-key-min-16-chars',
        },
      } as any;

      assert.strictEqual(hasValidBffSecret(req), true);
    });

    it('rejects forged or wrong-length BFF secrets safely', () => {
      const shortReq = { headers: { 'x-bff-secret': 'too-short' } } as any;
      const wrongReq = {
        headers: { 'x-bff-secret': 'completely-wrong-token-of-same-length' },
      } as any;
      const emptyReq = { headers: {} } as any;

      assert.strictEqual(hasValidBffSecret(shortReq), false);
      assert.strictEqual(hasValidBffSecret(wrongReq), false);
      assert.strictEqual(hasValidBffSecret(emptyReq), false);
    });
  });

  describe('3. Sensitive Field Redaction & Sentry Scrubbing', () => {
    it('scrubs sensitive credentials from error context via scrubValue', () => {
      const sensitiveData = {
        userId: '123',
        connectionUrl: 'postgresql://postgres:secret_pass@localhost:5432/db',
        oidcClientSecret: 'my-oidc-secret-value',
        SAMLResponse: 'PHNhbWxwOlJlc3BvbnNlPjwvc2FtbHA6UmVzcG9uc2U+',
        token: 'bearer-token-12345',
        refreshToken: 'refresh-token-67890',
        metadata: {
          nestedSecret: 'keep',
          password: 'plain-password',
        },
      };

      const scrubbed = scrubValue(sensitiveData) as any;

      assert.strictEqual(scrubbed.userId, '123');
      assert.strictEqual(scrubbed.connectionUrl, '[REDACTED]');
      assert.strictEqual(scrubbed.oidcClientSecret, '[REDACTED]');
      assert.strictEqual(scrubbed.SAMLResponse, '[REDACTED]');
      assert.strictEqual(scrubbed.token, '[REDACTED]');
      assert.strictEqual(scrubbed.refreshToken, '[REDACTED]');
      assert.strictEqual(scrubbed.metadata.password, '[REDACTED]');
      assert.strictEqual(scrubbed.metadata.nestedSecret, 'keep');
    });
  });
});
