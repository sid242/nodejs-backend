# Security & Authentication Rules

## 1. Authentication & Token Management

- Use short-lived JWT Access Tokens (e.g. 15 minutes) and rotating Refresh Tokens (e.g. 7 days).
- Refresh tokens are cryptographically hashed and stored in Redis with TTL (`src/modules/auth/tokens.js`):
  - On refresh, the existing token's `jti` is deleted and a new pair is issued (rotation).
  - On logout, the token family or `jti` is revoked immediately in Redis.
- Passwords must be hashed using `bcryptjs` with appropriate cost factors.

## 2. Rate Limiting Tiers

All rate limits use Redis storage (`rate-limit-redis`) to apply across all running API replicas:

- **Global Limiter (`globalLimiter`)**: Applied across `/api/v1/*` to protect against DDoS and brute force.
- **Auth Limiter (`authLimiter`)**: Strict limit applied to `/api/v1/auth/*` (login, register, reset-password).
- **Socket Rate Limits**: Handshake connection limit + per-second message rate limiter per connected user.

## 3. S3 File Upload Security

- Direct upload pattern via S3 Presigned POST:
  - Generate presigned POST url with strict `content-length-range` and matching `Content-Type`.
  - Client uploads directly to S3.
  - Client calls `/api/v1/files/:id/confirm` where backend verifies file existence and properties in S3 before marking `READY` and queuing processing.
  - S3 downloads use short-lived presigned GET URLs (`getSignedUrl`).

## 4. Input Sanitization & Traversal Defense

- Always sanitize filenames using `safeFilename()` (`src/lib/utils.js`) before generating S3 keys.
- Never trust client-provided object keys or paths.
- Helmet is enabled globally on all HTTP endpoints (with relaxed settings only on Bull-Board if needed).
- CORS is configured to only allow origins defined in `CORS_ORIGINS`.
