import pino from 'pino';
import { env } from '@/config/env.js';

// JSON to stdout in prod (ECS awslogs -> CloudWatch), pretty in dev.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: env.APP_NAME, env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
    },
  }),
});
