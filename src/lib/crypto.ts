import crypto from 'node:crypto';
import { env } from '@/config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes recommended for AES-GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a consistent 32-byte key using PBKDF2/scrypt from secret.
 */
function getDerivedKey(): Buffer {
  const secret = env.ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET;
  return crypto.scryptSync(secret, 'tenant-smtp-salt-v1', 32);
}

/**
 * Encrypts plaintext string using AES-256-GCM.
 * Output format: "ivHex:authTagHex:encryptedHex"
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return '';
  }
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM formatted ciphertext ("ivHex:authTagHex:encryptedHex").
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return '';
  }
  const parts = ciphertext.split(':');
  if (parts?.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted data parts');
  }

  const key = getDerivedKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid IV or auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
