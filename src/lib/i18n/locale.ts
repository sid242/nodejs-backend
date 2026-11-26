import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './locales';

/**
 * Normalizes an arbitrary locale or language tag into a supported base Locale.
 * e.g. "en-US" -> "en", "hi-IN" -> "hi", "HI" -> "hi", "fr" -> null, "!!" -> null.
 */
export function normalizeLocale(input?: string | null): Locale | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const base = trimmed.split(/[-_;]/)[0]?.toLowerCase().trim();
  if (!base) return null;
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : null;
}

/**
 * Parses an HTTP Accept-Language header, respects quality values (q),
 * and returns the highest-priority supported base Locale.
 */
export function parseAcceptLanguage(header?: string | null): Locale | null {
  if (!header || typeof header !== 'string') return null;
  const candidates: { locale: Locale; quality: number; order: number }[] = [];
  const parts = header.split(',');

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    if (!part) continue;
    const [rawLang, rawQ] = part.split(';');
    const normalized = normalizeLocale(rawLang);
    if (!normalized) continue;

    let quality = 1.0;
    if (rawQ) {
      const match = rawQ.match(/q=([0-9.]+)/i);
      if (match && match[1]) {
        const parsed = parseFloat(match[1]);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          quality = parsed;
        }
      }
    }
    candidates.push({ locale: normalized, quality, order: idx });
  }

  if (candidates.length === 0) return null;

  // Sort by highest quality first; preserve original header order for equal quality
  candidates.sort((a, b) => b.quality - a.quality || a.order - b.order);
  return candidates[0]?.locale ?? null;
}

export interface ResolveLocaleOptions {
  header?: string | null;
  userLocale?: string | null;
  tenantLocale?: string | null;
  acceptLanguage?: string | null;
}

/**
 * Resolves the effective locale using the priority order defined in the specification:
 * 1. x-locale header (set by BFF or caller)
 * 2. Authenticated user's locale (users.locale)
 * 3. Tenant's locale (tenants.locale / tenant_settings.locale)
 * 4. Accept-Language header
 * 5. Fallback DEFAULT_LOCALE ('en')
 */
export function resolveLocale(options?: ResolveLocaleOptions): Locale {
  if (!options) return DEFAULT_LOCALE;

  const fromHeader = normalizeLocale(options.header);
  if (fromHeader) return fromHeader;

  const fromUser = normalizeLocale(options.userLocale);
  if (fromUser) return fromUser;

  const fromTenant = normalizeLocale(options.tenantLocale);
  if (fromTenant) return fromTenant;

  const fromAcceptLanguage = parseAcceptLanguage(options.acceptLanguage);
  if (fromAcceptLanguage) return fromAcceptLanguage;

  return DEFAULT_LOCALE;
}
