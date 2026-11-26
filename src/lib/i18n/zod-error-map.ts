import type { ZodError } from 'zod';

import { getFixedT } from './index';
import type { Locale } from './locales';

/**
 * Localizes all issue messages within a ZodError according to the target Locale,
 * mapping Zod issue codes to localized dictionary strings.
 */
export function localizeZodError(err: ZodError, locale: Locale): ZodError {
  const t = getFixedT(locale);

  for (const rawIssue of err.issues) {
    const issue = rawIssue as unknown as Record<string, unknown>;
    const rawMsg = (issue.message as string) || '';

    // If the schema author explicitly provided a custom message, preserve it
    const isDefaultZodMsg =
      rawMsg.startsWith('Invalid ') ||
      rawMsg.startsWith('Expected ') ||
      rawMsg.startsWith('Required') ||
      rawMsg.startsWith('String must contain') ||
      rawMsg.startsWith('Number must be') ||
      rawMsg.startsWith('Array must contain') ||
      rawMsg.startsWith('Too small') ||
      rawMsg.startsWith('Too big') ||
      rawMsg === 'Invalid input';

    if (!isDefaultZodMsg) {
      continue;
    }

    const code = String(issue.code || '');

    switch (code) {
      case 'invalid_type':
        if (issue.received === 'undefined') {
          issue.message = t('validation.invalid_type_received_undefined');
        } else if (issue.received === 'null') {
          issue.message = t('validation.invalid_type_received_null');
        } else {
          issue.message = t('validation.invalid_type', {
            expected: issue.expected,
            received: issue.received,
          });
        }
        break;

      case 'too_small': {
        const type = (issue.origin as string) || (issue.type as string) || 'string';
        issue.message = t(`validation.too_small_${type}`, { minimum: issue.minimum });
        break;
      }

      case 'too_big': {
        const type = (issue.origin as string) || (issue.type as string) || 'string';
        issue.message = t(`validation.too_big_${type}`, { maximum: issue.maximum });
        break;
      }

      case 'invalid_format':
      case 'invalid_string': {
        const format = (issue.format as string) || (issue.validation as string);
        if (format === 'email') {
          issue.message = t('validation.invalid_string_email');
        } else if (format === 'url') {
          issue.message = t('validation.invalid_string_url');
        } else if (format === 'uuid') {
          issue.message = t('validation.invalid_string_uuid');
        } else if (format === 'regex') {
          issue.message = t('validation.invalid_string_regex');
        } else {
          issue.message = t('validation.invalid_string_regex');
        }
        break;
      }

      case 'invalid_enum_value':
      case 'invalid_value':
        issue.message = t('validation.invalid_enum_value', {
          options: ((issue.options as string[]) || []).join(', '),
        });
        break;

      case 'invalid_date':
        issue.message = t('validation.invalid_date');
        break;

      case 'invalid_literal':
        issue.message = t('validation.invalid_literal');
        break;

      case 'not_multiple_of':
        issue.message = t('validation.not_multiple_of', { multipleOf: issue.multipleOf });
        break;

      case 'not_finite':
        issue.message = t('validation.not_finite');
        break;

      case 'custom':
        issue.message = rawMsg || t('validation.custom');
        break;
    }
  }

  return err;
}
