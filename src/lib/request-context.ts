import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

import { resolveLocale } from './i18n/locale';
import { DEFAULT_LOCALE, type Locale } from './i18n/locales';

export interface RequestContextStore {
  clientHost?: string;
  locale?: Locale;
  res?: Response;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getClientHost(): string | undefined {
  return requestContext.getStore()?.clientHost;
}

export function getLocale(): Locale {
  return requestContext.getStore()?.locale ?? DEFAULT_LOCALE;
}

export function setRequestLocale(locale: Locale): void {
  const store = requestContext.getStore();
  if (store) {
    store.locale = locale;
    if (store.res && !store.res.headersSent) {
      store.res.setHeader('Content-Language', locale);
    }
  }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawClientHost =
    (req.headers['x-client-host'] as string | undefined) ||
    (req.headers['x-forwarded-host'] as string | undefined) ||
    (req.headers['host'] as string | undefined);

  const clientHost = rawClientHost?.split(',')?.[0]?.trim();

  const xLocale = (req.headers['x-locale'] as string | undefined) || undefined;
  const acceptLanguage = (req.headers['accept-language'] as string | undefined) || undefined;

  const initialLocale = resolveLocale({
    header: xLocale,
    acceptLanguage,
  });

  res.setHeader('Vary', 'Accept-Language, X-Locale');
  res.setHeader('Content-Language', initialLocale);

  requestContext.run({ clientHost, locale: initialLocale, res }, () => {
    next();
  });
}
