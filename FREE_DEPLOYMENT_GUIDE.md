# Complete Zero-Cost ($0/Month) Full-Stack Deployment Guide

This document outlines how to deploy the entire production stack—**Express API**, **PostgreSQL**, **Redis**, **BullMQ Workers**, **WebSockets (Socket.IO)**, **S3 Object Storage**, and **Transactional SMTP**—completely **free** ($0/month) without recurring subscriptions.

---

## 1. Architecture Overview & Component Matrix

| Service                    | Role in Architecture                         | Recommended $0 Provider                                                                       | Credit Card Required?          | Free Allowance                                      |
| :------------------------- | :------------------------------------------- | :-------------------------------------------------------------------------------------------- | :----------------------------- | :-------------------------------------------------- |
| **PostgreSQL**             | Primary Relational DB (Drizzle ORM)          | **[Neon.tech](https://neon.tech)** or **[Supabase](https://supabase.com)**                    | ❌ **No**                      | 0.5 GB storage, serverless compute                  |
| **Redis**                  | BullMQ Queues, Caching, Sockets, Rate Limits | **[Upstash](https://upstash.com)**                                                            | ❌ **No**                      | 10,000 commands/day, standard `rediss://`           |
| **Compute (API & Worker)** | Express REST API + WebSocket Server          | **[Koyeb](https://koyeb.com)** or **[Render](https://render.com)**                            | ❌ **No**                      | 1 free web service with WebSocket support           |
| **Object Storage**         | User Files, Avatars, Tenant Logos            | **[Supabase Storage](https://supabase.com)** or **[Backblaze B2](https://www.backblaze.com)** | ❌ **No**                      | 1 GB (Supabase) / 10 GB (Backblaze)                 |
| **Alternative Storage**    | S3-Compatible Storage                        | **[Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/)**                        | ⚠️ **Yes (verification only)** | 10 GB storage free, $0 egress fees                  |
| **Transactional SMTP**     | System & Tenant Welcome/Reset Emails         | **[Resend](https://resend.com)** or **[Brevo](https://www.brevo.com)**                        | ❌ **No**                      | 3,000 emails/mo (Resend) / 300/day (Brevo)          |
| **WebSockets**             | Real-Time Events & Notifications             | **Embedded in API**                                                                           | —                              | Scales via Redis pub/sub; no separate server needed |

---

## 2. Two Primary Deployment Strategies

### Strategy A: The "Managed Multi-Cloud Free Stack" (Zero Server Maintenance)

You connect independent free services via environment variables. There is no Linux server or Docker host to patch or maintain.

```
                    ┌─────────────────────────┐
                    │      Client Browser     │
                    └────────────┬────────────┘
                                 │ HTTPS & WSS
                                 ▼
                     ┌───────────────────────┐
                     │     Koyeb / Render    │
                     │  (Express + Socket)   │
                     └───────┬───────┬───────┘
          ┌──────────────────┼───────┴──────────────────┐
          ▼                  ▼                          ▼
   ┌─────────────┐    ┌─────────────┐            ┌─────────────┐
   │ Neon / Supa │    │   Upstash   │            │ Supabase S3 │
   │ (Postgres)  │    │   (Redis)   │            │  (Storage)  │
   └─────────────┘    └─────────────┘            └─────────────┘
```

#### Steps to Configure:

1. **Database ([Neon.tech](https://neon.tech))**:
   - Sign up with GitHub (no card needed).
   - Create a project and copy the connection string:
     ```env
     DATABASE_URL=postgresql://user:password@ep-sample-123.neon.tech/neondb?sslmode=require
     ```
   - Run migrations locally once before deploying:
     ```bash
     npm run db:migrate
     ```

2. **Redis ([Upstash](https://upstash.com))**:
   - Sign up with GitHub (no card needed).
   - Create a Redis database (select region closest to your database).
   - Copy the `ioredis` / Node connection string:
     ```env
     REDIS_URL=rediss://default:your_token@your-db.upstash.io:6379
     ```

3. **S3 Storage ([Supabase](https://supabase.com) or [Backblaze B2](https://www.backblaze.com))**:
   - **No Credit Card Required Option**: In Supabase, navigate to **Project Settings $\rightarrow$ Storage** and enable the S3 Access Keys.
     ```env
     S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
     S3_BUCKET=app-uploads
     AWS_REGION=us-east-1
     AWS_ACCESS_KEY_ID=<your-access-key-id>
     AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
     S3_FORCE_PATH_STYLE=true
     ```

4. **Email / SMTP ([Resend](https://resend.com))**:
   - Create an API key in Resend:
     ```env
     EMAIL_PROVIDER=smtp
     SMTP_HOST=smtp.resend.com
     SMTP_PORT=465
     SMTP_SECURE=true
     SMTP_USER=resend
     SMTP_PASS=re_your_api_key_here
     SMTP_FROM_EMAIL=onboarding@resend.dev
     ```

5. **Deploy API on [Koyeb](https://koyeb.com) or [Render](https://render.com)**:
   - Connect your GitHub repository.
   - Environment: **Docker** (uses existing `Dockerfile`).
   - Add the environment variables from above.
   - **Single Container Optimization**: Free hosting gives you 1 web container. To run both the HTTP API and the background BullMQ worker in that single container without paying for a second service, set the Docker start command to:
     ```bash
     node src/server.js & node src/worker.js
     ```

---

### Strategy B: The "All-in-One $0 VM" (Oracle Cloud Always Free)

If you want to run the exact [`docker-compose.yml`](file:///c:/Users/Siddharth%20Prajapati/Downloads/backend/node-scalable-foundation/docker-compose.yml) stack without splitting across multiple providers:

- **[Oracle Cloud Always Free Tier](https://www.oracle.com/cloud/free/)** includes:
  - **4 ARM Ampere OCPUs**
  - **24 GB of RAM**
  - **200 GB of SSD Block Storage**
  - Completely free forever (no charges after trial period expires).
- **Setup**:
  1. Provision an Ubuntu ARM instance in the Oracle Cloud Console.
  2. Install Docker & Docker Compose:
     ```bash
     sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
     ```
  3. Clone your repository, configure `.env`, and launch:
     ```bash
     docker compose --profile full up -d --build
     ```
  4. This runs **PostgreSQL, Redis, MinIO (S3), Nginx Reverse Proxy, Express API, and Background Worker** together on one server for $0.

---

## 3. WebSockets (Socket.IO) & Redis in Production

### Do WebSockets require a separate server?

**No.** Socket.IO runs attached directly to the existing Express HTTP server ([`src/server.ts`](file:///c:/Users/Siddharth%20Prajapati/Downloads/backend/node-scalable-foundation/src/server.ts)). When your API is deployed, the WebSocket server is deployed simultaneously on the same port.

### How WebSockets Scale Across Multiple Replicas:

1. **`@socket.io/redis-adapter`**:
   - API instances synchronize events via Redis pub/sub. If a user connected to Instance A receives a message from a user on Instance B, Redis delivers the message across instances.
2. **`transports: ['websocket']`**:
   - Locking the transport to pure WebSockets removes the need for sticky session cookies on load balancers.
3. **`@socket.io/redis-emitter`**:
   - Background workers running in [`src/worker.ts`](file:///c:/Users/Siddharth%20Prajapati/Downloads/backend/node-scalable-foundation/src/worker.ts) push notifications directly to clients via Redis (`emitToUser(userId, 'file:ready', payload)`), meaning worker processes do not need to run an open socket server.

---

## 4. MinIO vs. AWS S3: What You Need to Know

### Do you need to deploy MinIO?

**No, MinIO deployment is completely optional.**

- **Locally**: MinIO runs via Docker to provide a zero-cost, offline S3 emulator that saves files directly to your hard drive.
- **In Staging/Production**: You do **not** need to deploy or maintain MinIO. You simply point your `.env` to a cloud S3 provider (Supabase Storage, Backblaze B2, Cloudflare R2, or AWS S3).

### How to Migrate Assets from MinIO to S3:

Because MinIO implements the standard Amazon S3 API, you can mirror buckets using the official MinIO Client (`mc mirror`):

```bash
# Set aliases
mc alias set local http://localhost:9000 minioadmin minioadmin
mc alias set cloud https://s3.amazonaws.com <ACCESS_KEY> <SECRET_KEY>

# Mirror bucket
mc mirror local/app-uploads-local cloud/your-production-bucket
```

> [!NOTE]
> **Database Safety**: Database records in PostgreSQL only store relative keys (e.g. `users/123/avatar.png`), never hardcoded `http://localhost:9000` URLs. Switching storage providers requires updating environment variables only; no SQL updates are needed.

---

## 5. White-Labeling & Direct Domain Support

The white-labeling system supports three simultaneous routing modes:

1. **Direct Custom Root Domains** (`abc.com`, `xyz.com`):
   - Tenant sets their domain in workspace branding settings.
   - The customer points an `A Record` or `CNAME` to your server IP/domain.
   - When requests hit your server, the `Host` / `X-Forwarded-Host` header matches `TenantBranding.customDomain`.
2. **Subdomains** (`test.yourplatform.com`):
   - Subdomain (`test`) is extracted and resolved against `Tenant.slug`.
3. **Path / Slugs** (`yourplatform.com/test`):
   - Query parameter `?slug=test` matches `Tenant.slug`.

All public resolutions are cached in Redis under `branding:resolve:...` for 1 hour to prevent database load on high-traffic entry pages.

---

## 6. Complete Production Free-Tier `.env` File

```env
# Application Settings
NODE_ENV=production
APP_NAME=scalable-api
PORT=3000
LOG_LEVEL=info
TRUST_PROXY=1
CORS_ORIGINS=https://your-frontend-domain.com

# 1. PostgreSQL (Neon.tech or Supabase)
DATABASE_URL=postgresql://user:password@ep-sample-123.neon.tech/neondb?sslmode=require
DB_POOL_MAX=5
DB_CONNECT_TIMEOUT_SECONDS=10
DB_IDLE_TIMEOUT_SECONDS=30
DB_MAX_LIFETIME_SECONDS=1800

# 2. Redis (Upstash)
REDIS_URL=rediss://default:your_token@your-db.upstash.io:6379

# 3. JWT Secrets (Generate with `openssl rand -hex 32`)
JWT_ACCESS_SECRET=your_32_char_minimum_random_access_secret_string
JWT_REFRESH_SECRET=your_32_char_minimum_random_refresh_secret_string
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_SECONDS=604800

# 4. Storage (Supabase S3, Backblaze B2, or Cloudflare R2)
S3_BUCKET=app-uploads
S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
S3_FORCE_PATH_STYLE=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_storage_access_key
AWS_SECRET_ACCESS_KEY=your_storage_secret_key
S3_MAX_UPLOAD_MB=10

# 5. Email & SMTP (Resend, Brevo, or SendGrid)
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=re_your_api_key
SMTP_FROM_EMAIL=notifications@yourdomain.com
SMTP_FROM_NAME=Your SaaS Platform

# 6. Rate Limiting & Concurrency
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_MAX=10
WORKER_CONCURRENCY=5
EMAIL_WORKER_CONCURRENCY=5
FILE_WORKER_CONCURRENCY=2
MAINTENANCE_WORKER_CONCURRENCY=1
```
