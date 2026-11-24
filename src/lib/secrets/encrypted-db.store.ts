import { and, eq } from 'drizzle-orm';

import { db } from '@/config/db';
import { logger } from '@/config/logger';
import { tenantSecrets } from '@/db/schema/tenancy/tenant-secrets';
import { decrypt, encrypt, getActiveKeyId } from '@/lib/crypto';

import type { SecretStore } from './secret-store.interface';

export class EncryptedDbSecretStore implements SecretStore {
  async get(ref: string): Promise<string | null> {
    if (!ref) return null;

    try {
      // Support reference format: "tenant-secret:{tenantId}:{name}" or secret UUID
      if (ref.startsWith('tenant-secret:')) {
        const parts = ref.split(':');
        const tenantId = parts[1];
        const name = parts.slice(2).join(':');

        if (!tenantId || !name) return null;

        const [record] = await db
          .select({ ciphertext: tenantSecrets.ciphertext })
          .from(tenantSecrets)
          .where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.name, name)))
          .limit(1);

        if (!record) return null;
        return decrypt(record.ciphertext, { context: 'db-url' });
      }

      // Check if ref is a UUID
      const [record] = await db
        .select({ ciphertext: tenantSecrets.ciphertext })
        .from(tenantSecrets)
        .where(eq(tenantSecrets.id, ref))
        .limit(1);

      if (!record) return null;
      return decrypt(record.ciphertext, { context: 'db-url' });
    } catch (err: unknown) {
      logger.error({ err, ref }, 'Failed to retrieve/decrypt secret from database store');
      return null;
    }
  }

  async put(name: string, value: string, tenantId?: string): Promise<string> {
    if (!tenantId) {
      throw new Error('Tenant ID is required for database secret store');
    }

    const keyId = getActiveKeyId();
    const ciphertext = encrypt(value, { context: 'db-url', keyId });

    const ref = `tenant-secret:${tenantId}:${name}`;

    // Upsert tenant secret
    await db
      .insert(tenantSecrets)
      .values({
        tenantId,
        name,
        ciphertext,
        keyId,
      })
      .onConflictDoUpdate({
        target: [tenantSecrets.tenantId, tenantSecrets.name],
        set: {
          ciphertext,
          keyId,
          updatedAt: new Date(),
        },
      });

    return ref;
  }

  async delete(ref: string): Promise<void> {
    if (!ref) return;

    if (ref.startsWith('tenant-secret:')) {
      const parts = ref.split(':');
      const tenantId = parts[1];
      const name = parts.slice(2).join(':');

      if (tenantId && name) {
        await db
          .delete(tenantSecrets)
          .where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.name, name)));
      }
      return;
    }

    await db.delete(tenantSecrets).where(eq(tenantSecrets.id, ref));
  }
}
