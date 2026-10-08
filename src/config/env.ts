import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('api'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().default(1),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  DB_MAX_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_REDIS_URL: z.string().optional(),
  QUEUE_REDIS_URL: z.string().optional(),
  SOCKET_REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .default(60 * 60 * 24 * 7),

  AWS_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default('false'),
  S3_MAX_UPLOAD_MB: z.coerce.number().default(10),
  S3_DELETE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  SES_FROM_EMAIL: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),

  WORKER_CONCURRENCY: z.coerce.number().default(10),
  EMAIL_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).optional(),
  FILE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).optional(),
  MAINTENANCE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).optional(),
  MAINTENANCE_BATCH_SIZE: z.coerce.number().int().min(1).max(10000).default(500),
  CACHE_LOCK_TTL_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  SOCKET_CONNECTIONS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
  SOCKET_EVENTS_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(30),

  BULL_BOARD_USER: z.string().default('admin'),
  BULL_BOARD_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  CACHE_REDIS_URL: parsed.data.CACHE_REDIS_URL ?? parsed.data.REDIS_URL,
  QUEUE_REDIS_URL: parsed.data.QUEUE_REDIS_URL ?? parsed.data.REDIS_URL,
  SOCKET_REDIS_URL: parsed.data.SOCKET_REDIS_URL ?? parsed.data.REDIS_URL,
  EMAIL_WORKER_CONCURRENCY: parsed.data.EMAIL_WORKER_CONCURRENCY ?? parsed.data.WORKER_CONCURRENCY,
  FILE_WORKER_CONCURRENCY: parsed.data.FILE_WORKER_CONCURRENCY ?? 5,
  MAINTENANCE_WORKER_CONCURRENCY: parsed.data.MAINTENANCE_WORKER_CONCURRENCY ?? 1,
};

export type Env = typeof env;
export const isProd = env.NODE_ENV === 'production';
