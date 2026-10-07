---
name: docker-and-deployment
description: >-
  Use this skill when dealing with Docker containers, local docker-compose stacks (Postgres, Redis, MinIO, Nginx),
  AWS ECS Fargate task definitions, and GitHub Actions CI/CD workflows.
---

# Docker & Deployment Runbook

This guide covers local containerized development, Dockerfile builds, and AWS deployment configurations.

---

## 1. Local Development Stack (Docker Compose)

### Services Breakdown:
- **`postgres`**: Port 5432 (default db: `app`, user: `app`, password: `app`)
- **`redis`**: Port 6379 (`noeviction` maxmemory-policy for BullMQ)
- **`minio`**: Ports 9000 (S3 API) and 9001 (Console UI)
- **`nginx`**: Port 8080 (Load balancer profile)

### Commands:
- Start core infrastructure (PostgreSQL, Redis, MinIO):
  ```bash
  docker compose up -d
  ```
- Start full load-balanced multi-replica stack:
  ```bash
  docker compose --profile full up -d --build --scale api=3
  ```
- Stop containers and retain data volumes:
  ```bash
  docker compose down
  ```
- Reset data volumes completely:
  ```bash
  docker compose down -v
  ```

---

## 2. Dockerfile Build & Execution

The Dockerfile uses a lightweight multi-stage Node Alpine build:
- Base: `node:20-alpine` with `tini` process supervisor.
- API role command: `node src/server.js`
- Worker role command: `node src/worker.js`

Build image locally:
```bash
docker build -t node-scalable-foundation:latest .
```

---

## 3. AWS ECS Fargate Deployment

Task definitions live under `deploy/`:
- `deploy/task-def-api.json`: ECS task for API HTTP & Socket server.
- `deploy/task-def-worker.json`: ECS task for BullMQ background workers.

### Key Deployment Principles:
1. **Zero Secrets in Git / Env**: Production secrets are injected from AWS Secrets Manager directly into the ECS task definitions.
2. **Task Roles**: S3 and SES permissions are granted via IAM Task Role (`AWS_TASK_ROLE_ARN`), not static access keys.
3. **Database Migrations on Deploy**: Migrations run as a one-off ECS standalone task before updating the services.
4. **CI/CD Pipeline**: `.github/workflows/deploy.yml` automates:
   - Linting & Tests.
   - OIDC authentication with AWS.
   - ECR Docker build & push.
   - Automated ECS service rolling update.
