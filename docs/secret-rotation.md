# Zero-Downtime Secret Rotation Guide

This guide defines the standardized procedures for rotating cryptographic keys, operational secrets, and authentication credentials across the backend and frontend foundation.

---

## 1. Tenant Data Encryption Keys (`ENCRYPTION_KEYS`)

Database credentials, OIDC client secrets, and SMTP passwords are encrypted using an AES-256-GCM envelope format:
`v1:{keyId}:{ivHex}:{authTagHex}:{ciphertextHex}`

### Keyring Architecture
- `ENCRYPTION_KEYS`: Comma-separated map of Key IDs to raw 32-byte secret values, e.g.:
  `ENCRYPTION_KEYS="k1:secret_alpha_32chars_minimum...,k2:secret_bravo_32chars_minimum..."`
- `ENCRYPTION_ACTIVE_KEY`: The Key ID used for new writes and encryptions, e.g.:
  `ENCRYPTION_ACTIVE_KEY="k2"`

### Rotation Procedure
1. **Generate New Key**: Generate a cryptographically random 32+ character key.
2. **Add to Keyring without Switching Active**:
   Add the new key `k2` alongside the existing key `k1`:
   ```bash
   ENCRYPTION_KEYS="k1:<old-secret>,k2:<new-secret>"
   ENCRYPTION_ACTIVE_KEY="k1"
   ```
   Deploy this configuration. Existing data continues to decrypt using `k1`, while `k2` is recognized by all replicas.
3. **Switch Active Key**:
   Set `ENCRYPTION_ACTIVE_KEY="k2"`. Deploy. All new encryptions will now use `k2`. Data encrypted with `k1` continues to be decrypted seamlessly because the ciphertext contains the key ID prefix `v1:k1:...`.
4. **Re-encrypt Existing Data**:
   Run the idempotent re-encryption worker script:
   ```bash
   # Test in dry-run mode first
   npm run tsx src/scripts/reencrypt-secrets.ts --dry-run

   # Execute re-encryption
   npm run tsx src/scripts/reencrypt-secrets.ts
   ```
   This will decrypt all `v1:k1:...` and legacy records and re-encrypt them with `v1:k2:...`.
5. **Retire Old Key**:
   Once all rows in `tenant_secrets`, `tenant_sso_configs`, and `tenant_email_configs` are confirmed to use `k2`, remove `k1` from `ENCRYPTION_KEYS`:
   ```bash
   ENCRYPTION_KEYS="k2:<new-secret>"
   ENCRYPTION_ACTIVE_KEY="k2"
   ```

---

## 2. BFF Shared Secret (`BFF_SHARED_SECRET`)

The Next.js BFF and Express API authenticate internal proxy calls and tenant context overrides using `x-bff-secret`.

### Dual-Key Rollover Support
The backend middleware accepts two simultaneous secrets during rotation:
- `BFF_SHARED_SECRET`: The primary active secret.
- `BFF_SHARED_SECRET_PREVIOUS`: The retired secret accepted during the rollover window.

### Rotation Procedure
1. **Prepare New Secret**:
   Generate a new high-entropy string (≥32 chars): `new_bff_secret_xyz...`.
2. **Deploy Backend with Dual Verification**:
   ```bash
   BFF_SHARED_SECRET="new_bff_secret_xyz..."
   BFF_SHARED_SECRET_PREVIOUS="old_bff_secret_abc..."
   ```
   Deploy the backend API.
3. **Deploy Frontend BFF**:
   Update `BFF_SHARED_SECRET` in the frontend environment (`nextjs-frontend`):
   ```bash
   BFF_SHARED_SECRET="new_bff_secret_xyz..."
   ```
   Deploy the frontend. Since the backend accepts both, zero requests are rejected during the deployment window.
4. **Clean up Previous Secret on Backend**:
   Remove `BFF_SHARED_SECRET_PREVIOUS` from backend environment:
   ```bash
   BFF_SHARED_SECRET="new_bff_secret_xyz..."
   unset BFF_SHARED_SECRET_PREVIOUS
   ```

---

## 3. JWT Access & Refresh Secrets

### JWT Access Secret (`JWT_ACCESS_SECRET`)
- **TTL**: 15 minutes.
- **Strategy**: Because access tokens expire in 15 minutes, rotating `JWT_ACCESS_SECRET` causes clients to refresh their tokens via their refresh token.
- To achieve 100% zero re-login, rotate `JWT_ACCESS_SECRET` during low-traffic windows or verify against a dual-key window.

### JWT Refresh Secret (`JWT_REFRESH_SECRET`)
- Refresh tokens are stored hashed (SHA-256) in Redis (`refresh_token:{hash}`).
- Rotating `JWT_REFRESH_SECRET` can be performed by verifying tokens against `JWT_REFRESH_SECRET_PREVIOUS` during a 7-day rolling window if needed.

---

## 4. Internal API Secret (`INTERNAL_API_SECRET`)

Used for secure service-to-service calls (e.g. domain verification webhooks, cron trigger workers).
- Supports rolling replacement by deploying consumer and producer updates in lockstep.
