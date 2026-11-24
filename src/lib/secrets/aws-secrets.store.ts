import { logger } from '@/config/logger';

import { EncryptedDbSecretStore } from './encrypted-db.store';
import type { SecretStore } from './secret-store.interface';

/**
 * AWS Secrets Manager Driver.
 * Dynamically utilizes @aws-sdk/client-secrets-manager when available,
 * otherwise transparently delegates to EncryptedDbSecretStore.
 */
export class AwsSecretsManagerStore implements SecretStore {
  private fallbackStore = new EncryptedDbSecretStore();

  async get(ref: string): Promise<string | null> {
    try {
      // @ts-expect-error Optional dependency @aws-sdk/client-secrets-manager
      const awsSdk: any = await import('@aws-sdk/client-secrets-manager').catch(() => null);
      if (!awsSdk) {
        return this.fallbackStore.get(ref);
      }

      const { SecretsManagerClient, GetSecretValueCommand } = awsSdk;
      const client = new SecretsManagerClient({});
      const response = await client.send(new GetSecretValueCommand({ SecretId: ref }));
      return response.SecretString ?? null;
    } catch {
      return this.fallbackStore.get(ref);
    }
  }

  async put(name: string, value: string, tenantId?: string): Promise<string> {
    try {
      // @ts-expect-error Optional dependency @aws-sdk/client-secrets-manager
      const awsSdk: any = await import('@aws-sdk/client-secrets-manager').catch(() => null);
      if (!awsSdk) {
        return this.fallbackStore.put(name, value, tenantId);
      }

      const { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand } = awsSdk;

      const client = new SecretsManagerClient({});
      const secretId = `tenants/${tenantId ?? 'default'}/${name}`;

      try {
        await client.send(
          new CreateSecretCommand({
            Name: secretId,
            SecretString: value,
          }),
        );
      } catch (err: any) {
        if (err.name === 'ResourceExistsException') {
          await client.send(
            new PutSecretValueCommand({
              SecretId: secretId,
              SecretString: value,
            }),
          );
        } else {
          throw err;
        }
      }

      return secretId;
    } catch (err: unknown) {
      logger.warn(
        { err },
        'AWS Secrets Manager not accessible, persisting to encrypted DB fallback',
      );
      return this.fallbackStore.put(name, value, tenantId);
    }
  }

  async delete(ref: string): Promise<void> {
    try {
      // @ts-expect-error Optional dependency @aws-sdk/client-secrets-manager
      const awsSdk: any = await import('@aws-sdk/client-secrets-manager').catch(() => null);
      if (!awsSdk) {
        return this.fallbackStore.delete(ref);
      }

      const { SecretsManagerClient, DeleteSecretCommand } = awsSdk;
      const client = new SecretsManagerClient({});
      await client.send(
        new DeleteSecretCommand({ SecretId: ref, ForceDeleteWithoutRecovery: true }),
      );
    } catch {
      await this.fallbackStore.delete(ref);
    }
  }
}
