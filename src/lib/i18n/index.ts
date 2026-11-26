import i18next, { type i18n as I18nInstance } from 'i18next';

import enCommon from '@/locales/en/common.json';
import enEmails from '@/locales/en/emails.json';
import enErrors from '@/locales/en/errors.json';
import enNotifications from '@/locales/en/notifications.json';
import enValidation from '@/locales/en/validation.json';
import hiCommon from '@/locales/hi/common.json';
import hiEmails from '@/locales/hi/emails.json';
import hiErrors from '@/locales/hi/errors.json';
import hiNotifications from '@/locales/hi/notifications.json';
import hiValidation from '@/locales/hi/validation.json';

import { getLocale } from '../request-context';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './locales';

export const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    validation: enValidation,
    notifications: enNotifications,
    emails: enEmails,
  },
  hi: {
    common: hiCommon,
    errors: hiErrors,
    validation: hiValidation,
    notifications: hiNotifications,
    emails: hiEmails,
  },
} as const;

export const i18n: I18nInstance = i18next.createInstance();

i18n.init({
  resources,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  ns: ['common', 'errors', 'validation', 'notifications', 'emails'],
  defaultNS: 'common',
  nsSeparator: '.',
  keySeparator: '.',
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

/**
 * Returns a translator fixed to a specific locale (used in background workers, emails, push).
 */
export function getFixedT(locale?: Locale | string | null) {
  const target = (locale as Locale) || DEFAULT_LOCALE;
  return i18n.getFixedT(target);
}

/**
 * Translates a key, dynamically resolving the locale from the current request context.
 */
export function t(key: string, options?: Record<string, unknown>): string {
  const locale = getLocale();
  return i18n.t(key, { lng: locale, ...options }) as string;
}

export const tr = t;

export * from './locales';
export * from './locale';
