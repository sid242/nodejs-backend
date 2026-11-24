import { env } from '@/config/env';

import { AwsSecretsManagerStore } from './aws-secrets.store';
import { EncryptedDbSecretStore } from './encrypted-db.store';
import type { SecretStore } from './secret-store.interface';

export * from './secret-store.interface';
export * from './encrypted-db.store';
export * from './aws-secrets.store';

let secretStoreInstance: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (secretStoreInstance) {
    return secretStoreInstance;
  }

  if (env.SECRET_STORE_PROVIDER === 'aws') {
    secretStoreInstance = new AwsSecretsManagerStore();
  } else {
    secretStoreInstance = new EncryptedDbSecretStore();
  }

  return secretStoreInstance;
}
