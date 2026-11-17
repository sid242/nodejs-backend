export interface SecretStore {
  /**
   * Retrieves and decrypts the secret value by reference.
   */
  get(ref: string): Promise<string | null>;

  /**
   * Encrypts and stores the secret value, returning a unique secret reference.
   */
  put(name: string, value: string, tenantId?: string): Promise<string>;

  /**
   * Deletes the secret by reference.
   */
  delete(ref: string): Promise<void>;
}
