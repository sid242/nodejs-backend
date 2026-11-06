import path from 'node:path';
import pino from 'pino';

import { env } from '@/config/env';

/**
 * Extracts the file path and line number of the caller invoking the logger.
 * Strips node internals, dependencies, and project root for clean, readable output.
 */
function getCallerLocation(): string | undefined {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');
  const cwd = process.cwd();

  for (const line of lines) {
    const match = line.match(
      /(?:at\s+(?:.*?\s+\()?)?(?:file:\/\/)?([A-Za-z]:[\\/][^):]+|\/[^):]+):(\d+)(?::\d+)?\)?/,
    );
    if (!match) continue;

    const fullPath = match[1]!;
    const lineNum = match[2]!;
    const normalized = fullPath.replace(/\\/g, '/');

    // Skip node internals, pino, node_modules, and logger itself
    if (
      normalized.includes('node_modules') ||
      normalized.includes('node:') ||
      normalized.includes('/src/config/logger.ts') ||
      line.includes('getCallerLocation')
    ) {
      continue;
    }

    const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');
    return `${relPath}:${lineNum}`;
  }

  return undefined;
}

// JSON to stdout in prod (ECS awslogs -> CloudWatch), pretty in dev.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: env.APP_NAME, env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const caller = getCallerLocation();
    return caller ? { caller } : {};
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-support-token"]',
      'req.headers["x-api-key"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.supportToken',
      '*.secret',
      '*.clientSecret',
      '*.totpSecret',
      '*.recoveryCodes',
      '*.encryptionKey',
      '*.apiKey',
      '*.databaseUrl',
      '*.connectionUrl',
      '*.creditCard',
      '*.cardNumber',
      '*.cvv',
      '*.cvc',
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
