import { eq, isNotNull, sql } from 'drizzle-orm';

import { closeDb, db } from '@/config/db';
import { logger } from '@/config/logger';
import { tenantEmailConfigs, tenants, tenantSecrets, tenantSsoConfigs } from '@/db/schema/index';
import { decrypt, encrypt, getActiveKeyId, needsReencryption } from '@/lib/crypto';
import { getSecretStore } from '@/lib/secrets';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const activeKeyId = getActiveKeyId();

  logger.info({ isDryRun, activeKeyId }, 'Starting secret re-encryption and migration job');

  let ssoUpdated = 0;
  let smtpUpdated = 0;
  let secretsUpdated = 0;
  let dedicatedDbMigrated = 0;

  // 1. Re-encrypt tenant SSO OIDC client secrets
  const ssoConfigs = await db
    .select({
      id: tenantSsoConfigs.id,
      tenantId: tenantSsoConfigs.tenantId,
      oidcClientSecret: tenantSsoConfigs.oidcClientSecret,
    })
    .from(tenantSsoConfigs)
    .where(isNotNull(tenantSsoConfigs.oidcClientSecret));

  for (const row of ssoConfigs) {
    if (!row.oidcClientSecret || row.oidcClientSecret === '••••••••') continue;

    if (needsReencryption(row.oidcClientSecret)) {
      let plaintext = '';
      try {
        plaintext = decrypt(row.oidcClientSecret);
      } catch {
        // If decryption fails, it may have been stored as raw plaintext in legacy records
        plaintext = row.oidcClientSecret;
      }

      if (plaintext) {
        const reencrypted = encrypt(plaintext);
        if (!isDryRun) {
          await db
            .update(tenantSsoConfigs)
            .set({ oidcClientSecret: reencrypted, updatedAt: new Date() })
            .where(eq(tenantSsoConfigs.id, row.id));
        }
        ssoUpdated++;
      }
    }
  }

  // 2. Re-encrypt tenant SMTP passwords
  const emailConfigs = await db
    .select({
      id: tenantEmailConfigs.id,
      tenantId: tenantEmailConfigs.tenantId,
      passwordEncrypted: tenantEmailConfigs.passwordEncrypted,
    })
    .from(tenantEmailConfigs)
    .where(isNotNull(tenantEmailConfigs.passwordEncrypted));

  for (const row of emailConfigs) {
    if (!row.passwordEncrypted) continue;

    if (needsReencryption(row.passwordEncrypted)) {
      try {
        const plaintext = decrypt(row.passwordEncrypted, { context: 'smtp' });
        const reencrypted = encrypt(plaintext, { context: 'smtp' });
        if (!isDryRun) {
          await db
            .update(tenantEmailConfigs)
            .set({ passwordEncrypted: reencrypted, updatedAt: new Date() })
            .where(eq(tenantEmailConfigs.id, row.id));
        }
        smtpUpdated++;
      } catch (err) {
        logger.warn({ err, tenantId: row.tenantId }, 'Failed to decrypt legacy SMTP pass');
      }
    }
  }

  // 3. Re-encrypt existing tenant_secrets table entries
  const existingSecrets = await db
    .select({
      id: tenantSecrets.id,
      tenantId: tenantSecrets.tenantId,
      name: tenantSecrets.name,
      ciphertext: tenantSecrets.ciphertext,
    })
    .from(tenantSecrets);

  for (const row of existingSecrets) {
    if (needsReencryption(row.ciphertext)) {
      try {
        const plaintext = decrypt(row.ciphertext, { context: 'db-url' });
        const reencrypted = encrypt(plaintext, { context: 'db-url', keyId: activeKeyId });
        if (!isDryRun) {
          await db
            .update(tenantSecrets)
            .set({ ciphertext: reencrypted, keyId: activeKeyId, updatedAt: new Date() })
            .where(eq(tenantSecrets.id, row.id));
        }
        secretsUpdated++;
      } catch (err) {
        logger.warn({ err, secretId: row.id }, 'Failed to re-encrypt tenant secret');
      }
    }
  }

  // 4. Migrate legacy metadata.connectionUrl to SecretStore
  const legacyTenants = await db
    .select({
      id: tenants.id,
      databaseSecretRef: tenants.databaseSecretRef,
      metadata: tenants.metadata,
    })
    .from(tenants)
    .where(sql`${tenants.metadata}->>'connectionUrl' IS NOT NULL`);

  const secretStore = getSecretStore();

  for (const tenant of legacyTenants) {
    const meta = (tenant.metadata as Record<string, unknown>) || {};
    const connectionUrl = meta.connectionUrl as string | undefined;

    if (connectionUrl) {
      if (!isDryRun) {
        const secretRef = await secretStore.put('db-connection-url', connectionUrl, tenant.id);
        const updatedMeta = { ...meta };
        delete updatedMeta.connectionUrl;

        await db
          .update(tenants)
          .set({
            databaseSecretRef: secretRef,
            metadata: updatedMeta,
          })
          .where(eq(tenants.id, tenant.id));
      }
      dedicatedDbMigrated++;
    }
  }

  logger.info(
    {
      isDryRun,
      activeKeyId,
      ssoUpdated,
      smtpUpdated,
      secretsUpdated,
      dedicatedDbMigrated,
    },
    'Secret re-encryption and migration job completed successfully',
  );

  await closeDb();
}

main().catch((err) => {
  logger.fatal({ err }, 'Secret re-encryption script failed');
  process.exit(1);
});
