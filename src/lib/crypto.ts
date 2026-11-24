import crypto from 'node:crypto';

import { env } from '@/config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes recommended for AES-GCM
const AUTH_TAG_LENGTH = 16;
const CIPHERTEXT_PREFIX = 'v1:';
const LEGACY_SALT = 'tenant-smtp-salt-v1';

/**
 * Parsed encryption keyring mapping Key ID -> Raw Secret Buffer / String
 */
interface Keyring {
  activeKeyId: string;
  keys: Map<string, string>;
}

let cachedKeyring: Keyring | null = null;

export function loadKeyring(): Keyring {
  if (cachedKeyring) return cachedKeyring;

  const keys = new Map<string, string>();
  let activeKeyId = env.ENCRYPTION_ACTIVE_KEY || 'default';

  // 1. Parse ENCRYPTION_KEYS="k1:secret1,k2:secret2"
  if (env.ENCRYPTION_KEYS) {
    const pairs = env.ENCRYPTION_KEYS.split(',');
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const id = pair.slice(0, idx).trim();
        const secret = pair.slice(idx + 1).trim();
        if (id && secret) {
          keys.set(id, secret);
        }
      }
    }
  }

  // 2. Single ENCRYPTION_KEY fallback
  if (env.ENCRYPTION_KEY) {
    if (!keys.has('default')) {
      keys.set('default', env.ENCRYPTION_KEY);
    }
    // Also store under activeKeyId if not already present
    if (!keys.has(activeKeyId)) {
      keys.set(activeKeyId, env.ENCRYPTION_KEY);
    }
  }

  // 3. Fallback for test/dev when neither is provided
  if (keys.size === 0) {
    const devFallback = env.JWT_ACCESS_SECRET;
    keys.set('default', devFallback);
    activeKeyId = 'default';
  }

  // Ensure activeKeyId exists in keys, otherwise pick first available
  if (!keys.has(activeKeyId)) {
    const firstKey = keys.keys().next().value;
    if (firstKey) activeKeyId = firstKey;
  }

  cachedKeyring = { activeKeyId, keys };
  return cachedKeyring;
}

export function getActiveKeyId(): string {
  return loadKeyring().activeKeyId;
}

/**
 * Derives a consistent 32-byte key using HKDF with SHA-256.
 * Incorporates a domain/context string ('sso-secret', 'smtp', 'db-url') to avoid key reuse cross-domain.
 */
export function deriveKey(secret: string, context = 'general-secret'): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, 'antigravity-envelope-salt-v1', context, 32),
  );
}

/**
 * Legacy key derivation function for backwards compatibility with 3-part ciphertext.
 */
function getLegacyDerivedKey(): Buffer {
  const secret = env.ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET;
  return crypto.scryptSync(secret, LEGACY_SALT, 32);
}

export interface EncryptOptions {
  keyId?: string;
  context?: string;
}

/**
 * Encrypts plaintext string using AES-256-GCM envelope format.
 * Format: "v1:{keyId}:{ivHex}:{authTagHex}:{encryptedHex}"
 */
export function encrypt(plaintext: string, options?: EncryptOptions): string {
  if (!plaintext) {
    return '';
  }

  const keyring = loadKeyring();
  const keyId = options?.keyId || keyring.activeKeyId;
  const secret = keyring.keys.get(keyId);

  if (!secret) {
    throw new Error(`Encryption key '${keyId}' not found in keyring`);
  }

  const derivedKey = deriveKey(secret, options?.context ?? 'general-secret');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${CIPHERTEXT_PREFIX}${keyId}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export interface DecryptOptions {
  context?: string;
}

/**
 * Decrypts AES-256-GCM ciphertext.
 * Supports:
 * - v1 envelope format: "v1:{keyId}:{ivHex}:{authTagHex}:{encryptedHex}"
 * - legacy 3-part format: "{ivHex}:{authTagHex}:{encryptedHex}"
 */
export function decrypt(ciphertext: string, options?: DecryptOptions): string {
  if (!ciphertext) {
    return '';
  }

  // 1. Handle v1 Envelope format
  if (ciphertext.startsWith(CIPHERTEXT_PREFIX)) {
    const raw = ciphertext.slice(CIPHERTEXT_PREFIX.length);
    const parts = raw.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid v1 encrypted data format: expected 4 parts');
    }

    const [keyId, ivHex, authTagHex, encryptedHex] = parts;
    if (!keyId || !ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid v1 encrypted data parts');
    }

    const keyring = loadKeyring();
    const secret = keyring.keys.get(keyId);
    if (!secret) {
      throw new Error(`Cannot decrypt secret: keyId '${keyId}' not present in keyring`);
    }

    const key = deriveKey(secret, options?.context ?? 'general-secret');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid IV or auth tag length in v1 ciphertext');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // 2. Handle legacy 3-part format: "ivHex:authTagHex:encryptedHex"
  const parts = ciphertext.split(':');
  if (parts.length === 3) {
    const [ivHex, authTagHex, encryptedHex] = parts;
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid legacy encrypted data parts');
    }

    const key = getLegacyDerivedKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid IV or auth tag length in legacy ciphertext');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error('Unrecognized ciphertext format');
}

/**
 * Checks if ciphertext needs re-encryption:
 * returns true if it is in legacy 3-part format or was encrypted with an older/inactive keyId.
 */
export function needsReencryption(ciphertext?: string | null): boolean {
  if (!ciphertext || typeof ciphertext !== 'string') return false;
  if (!ciphertext.startsWith(CIPHERTEXT_PREFIX)) return true;

  const raw = ciphertext.slice(CIPHERTEXT_PREFIX.length);
  const parts = raw.split(':');
  if (parts.length !== 4) return true;

  const keyId = parts[0];
  const activeKeyId = getActiveKeyId();
  return keyId !== activeKeyId;
}

/**
 * Resets cached keyring (useful in unit tests when changing environment variables).
 */
export function resetCachedKeyring(): void {
  cachedKeyring = null;
}

/**
 * Constant-time string comparison resistant to timing attacks and length leaks.
 * Hashes both strings with SHA-256 before timingSafeEqual to avoid leaking string length.
 */
export function safeEqual(a?: string | null, b?: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
