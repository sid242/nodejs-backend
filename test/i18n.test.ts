import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '@/lib/errors';
import {
  DEFAULT_LOCALE,
  getFixedT,
  normalizeLocale,
  parseAcceptLanguage,
  resolveLocale,
} from '@/lib/i18n';
import { localizeZodError } from '@/lib/i18n/zod-error-map';
import { getLocale, requestContext } from '@/lib/request-context';
import { errorHandler } from '@/middleware/error';
import { updateTenantSettingsDto } from '@/modules/tenants/tenants.dto';
import { updateMeDto } from '@/modules/users/users.dto';

test('i18n: normalizeLocale converts locale tags to supported base language', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('en_GB'), 'en');
  assert.equal(normalizeLocale('EN'), 'en');
  assert.equal(normalizeLocale('hi'), 'hi');
  assert.equal(normalizeLocale('hi-IN'), 'hi');
  assert.equal(normalizeLocale('HI'), 'hi');

  // Unsupported or invalid tags
  assert.equal(normalizeLocale('fr'), null);
  assert.equal(normalizeLocale('es-ES'), null);
  assert.equal(normalizeLocale('xx'), null);
  assert.equal(normalizeLocale('!!'), null);
  assert.equal(normalizeLocale(''), null);
  assert.equal(normalizeLocale(null), null);
  assert.equal(normalizeLocale(undefined), null);
});

test('i18n: parseAcceptLanguage respects quality weighting and order', () => {
  // Simple match
  assert.equal(parseAcceptLanguage('hi-IN,hi;q=0.9,en;q=0.8'), 'hi');
  assert.equal(parseAcceptLanguage('en-US,en;q=0.9,hi;q=0.8'), 'en');

  // Quality ordering: hi has higher q
  assert.equal(parseAcceptLanguage('en;q=0.5,hi;q=0.9'), 'hi');

  // Unsupported languages skipped
  assert.equal(parseAcceptLanguage('fr-FR,fr;q=0.9,de;q=0.8,hi;q=0.7'), 'hi');
  assert.equal(parseAcceptLanguage('fr-FR,fr;q=0.9,de;q=0.8'), null);

  // Fallbacks
  assert.equal(parseAcceptLanguage(''), null);
  assert.equal(parseAcceptLanguage(null), null);
  assert.equal(parseAcceptLanguage(undefined), null);
});

test('i18n: resolveLocale follows strict precedence order', () => {
  // 1. Header wins over everything
  assert.equal(
    resolveLocale({
      header: 'hi',
      userLocale: 'en',
      tenantLocale: 'en',
      acceptLanguage: 'en',
    }),
    'hi',
  );

  // 2. User locale wins if header is absent/invalid
  assert.equal(
    resolveLocale({
      header: 'xx',
      userLocale: 'hi',
      tenantLocale: 'en',
      acceptLanguage: 'en',
    }),
    'hi',
  );

  // 3. Tenant locale wins if header and user are absent/invalid
  assert.equal(
    resolveLocale({
      header: null,
      userLocale: null,
      tenantLocale: 'hi',
      acceptLanguage: 'en',
    }),
    'hi',
  );

  // 4. Accept-Language wins if previous are absent/invalid
  assert.equal(
    resolveLocale({
      header: undefined,
      userLocale: undefined,
      tenantLocale: 'invalid',
      acceptLanguage: 'hi-IN,hi;q=0.9',
    }),
    'hi',
  );

  // 5. Default locale fallback
  assert.equal(
    resolveLocale({
      header: 'unsupported',
      userLocale: 'xx',
      tenantLocale: 'yy',
      acceptLanguage: 'fr,de',
    }),
    DEFAULT_LOCALE,
  );
  assert.equal(resolveLocale(), DEFAULT_LOCALE);
});

test('i18n: getFixedT provides fixed-locale translations with interpolation', () => {
  const tEn = getFixedT('en');
  const tHi = getFixedT('hi');

  assert.equal(tEn('errors.UNAUTHORIZED'), 'Unauthorized');
  assert.equal(tHi('errors.UNAUTHORIZED'), 'अनधिकृत');

  assert.equal(
    tEn('validation.invalid_type', { expected: 'string', received: 'number' }),
    'Expected string, received number',
  );
  assert.equal(
    tHi('validation.invalid_type', { expected: 'string', received: 'number' }),
    'string अपेक्षित था, number प्राप्त हुआ',
  );
});

test('i18n: request context isolation preserves per-request locale', async () => {
  let localeInStore1 = '';
  let localeInStore2 = '';

  await Promise.all([
    new Promise<void>((resolve) => {
      requestContext.run({ clientHost: 'host1', locale: 'hi' }, () => {
        setTimeout(() => {
          localeInStore1 = getLocale();
          resolve();
        }, 10);
      });
    }),
    new Promise<void>((resolve) => {
      requestContext.run({ clientHost: 'host2', locale: 'en' }, () => {
        setTimeout(() => {
          localeInStore2 = getLocale();
          resolve();
        }, 5);
      });
    }),
  ]);

  assert.equal(localeInStore1, 'hi');
  assert.equal(localeInStore2, 'en');
});

test('i18n: DTO validation rejects invalid locale xx and accepts supported locales', () => {
  // User DTO rejects 'xx'
  const invalidUser = updateMeDto.safeParse({ locale: 'xx' });
  assert.equal(invalidUser.success, false);

  const validUserEn = updateMeDto.safeParse({ locale: 'en' });
  assert.equal(validUserEn.success, true);

  const validUserHi = updateMeDto.safeParse({ locale: 'hi' });
  assert.equal(validUserHi.success, true);

  // Tenant DTO rejects 'xx'
  const invalidTenant = updateTenantSettingsDto.safeParse({ locale: 'xx' });
  assert.equal(invalidTenant.success, false);

  // Tenant DTO accepts 'en-US' (base language is 'en')
  const validTenantUs = updateTenantSettingsDto.safeParse({ locale: 'en-US' });
  assert.equal(validTenantUs.success, true);

  const validTenantHi = updateTenantSettingsDto.safeParse({ locale: 'hi-IN' });
  assert.equal(validTenantHi.success, true);
});

test('i18n: errorHandler returns localized error messages based on requestContext locale', () => {
  const err = new AppError(401, 'Unauthorized fallback', 'UNAUTHORIZED');

  // Test with Hindi locale in request context
  let statusCaptured = 0;
  const capturedRef: { body?: { error?: { code?: string; message?: string } } } = {};
  const mockResHi = {
    status(s: number) {
      statusCaptured = s;
      return this;
    },
    json(b: { error?: { code?: string; message?: string } }) {
      capturedRef.body = b;
      return this;
    },
  } as unknown as Response;

  requestContext.run({ locale: 'hi' }, () => {
    errorHandler(err, { id: 'req_123' } as unknown as Request, mockResHi, () => {});
  });

  assert.equal(statusCaptured, 401);
  assert.equal(capturedRef.body?.error?.code, 'UNAUTHORIZED');
  assert.equal(capturedRef.body?.error?.message, 'अनधिकृत');

  // Test with English locale in request context
  requestContext.run({ locale: 'en' }, () => {
    errorHandler(err, { id: 'req_124' } as unknown as Request, mockResHi, () => {});
  });

  assert.equal(statusCaptured, 401);
  assert.equal(capturedRef.body?.error?.code, 'UNAUTHORIZED');
  assert.equal(capturedRef.body?.error?.message, 'Unauthorized');
});

test('i18n: localizeZodError translates validation issue messages into Hindi', () => {
  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(3),
  });

  const result = schema.safeParse({ email: 'not-an-email', name: 'a' });
  assert.equal(result.success, false);
  if (!result.success) {
    const localized = localizeZodError(result.error, 'hi');
    const flattened = localized.flatten();
    const fieldErrors = flattened.fieldErrors as Record<string, string[] | undefined>;
    assert.equal(fieldErrors.email?.[0], 'अमान्य ईमेल पता');
    assert.equal(fieldErrors.name?.[0], 'कम से कम 3 अक्षर होने चाहिए');
  }
});
