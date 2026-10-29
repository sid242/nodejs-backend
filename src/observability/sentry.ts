import * as Sentry from '@sentry/node';
import type { Request } from 'express';

import { env } from '@/config/env';
import { logger } from '@/config/logger';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'supporttoken',
  'secret',
  'totpsecret',
  'recoverycodes',
  'encryptionkey',
  'apikey',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
]);

export function scrubValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.map(scrubValue);
  if (typeof val === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        res[k] = '[REDACTED]';
      } else {
        res[k] = scrubValue(v);
      }
    }
    return res;
  }
  return val;
}

let initialized = false;

export function initSentry(): void {
  if (initialized) return;

  if (!env.SENTRY_DSN) {
    logger.debug('Sentry disabled: SENTRY_DSN not configured');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    serverName: env.APP_NAME,
    sampleRate: env.SENTRY_SAMPLE_RATE,
    beforeSend(event) {
      // 1. Scrub HTTP headers
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers['x-support-token'];
        delete event.request.headers['x-api-key'];
      }
      // 2. Scrub request data / body
      if (event.request?.data) {
        event.request.data = scrubValue(event.request.data);
      }
      // 3. Scrub extra context
      if (event.extra) {
        event.extra = scrubValue(event.extra) as Record<string, unknown>;
      }
      return event;
    },
  });

  initialized = true;
  logger.info({ service: env.APP_NAME, env: env.NODE_ENV }, 'Sentry initialized for error monitoring');
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export function captureException(
  err: unknown,
  context?: {
    req?: Request;
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
  },
): void {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    const req = context?.req;
    if (req) {
      if (req.id) scope.setTag('requestId', String(req.id));
      if (req.tenant?.id) scope.setTag('tenantId', req.tenant.id);
      if (req.tenant?.slug) scope.setTag('tenantSlug', req.tenant.slug);
      if (req.user?.id) scope.setUser({ id: req.user.id });
      if (req.staff?.id) scope.setTag('staffId', req.staff.id);
      if (req.isSupportSession) scope.setTag('isSupportSession', 'true');
      if (req.method) scope.setTag('method', req.method);
      if (req.originalUrl) scope.setTag('url', req.originalUrl);
    }

    if (context?.tags) {
      for (const [k, v] of Object.entries(context.tags)) {
        scope.setTag(k, String(v));
      }
    }

    if (context?.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        scope.setExtra(k, scrubValue(v));
      }
    }

    Sentry.captureException(err);
  });
}

export function captureJobException(
  err: unknown,
  job: {
    id?: string;
    name: string;
    data?: any;
    queueName?: string;
  },
): void {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    if (job.id) scope.setTag('jobId', job.id);
    scope.setTag('jobName', job.name);
    if (job.queueName) scope.setTag('queueName', job.queueName);
    if (job.data?.tenantId) scope.setTag('tenantId', String(job.data.tenantId));

    if (job.data) {
      scope.setExtra('jobData', scrubValue(job.data));
    }

    Sentry.captureException(err);
  });
}
