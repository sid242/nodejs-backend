import { AppError } from '@/lib/errors';

/**
 * Normalizes and validates a phone number into strict E.164 format.
 * Examples:
 *   "+91 98765-43210" -> "+919876543210"
 *   "9876543210" (with default country code +91) -> "+919876543210"
 */
export function normalizePhoneNumber(raw: string, defaultCountryCode = '91'): string {
  if (!raw || typeof raw !== 'string') {
    throw AppError.badRequest('Phone number is required', { raw });
  }

  // Remove whitespace, dashes, parens, brackets, dots
  let cleaned = raw.replace(/[\s\-().[\]]/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 10 && defaultCountryCode) {
    // 10-digit standard Indian/US number without prefix
    cleaned = `${defaultCountryCode}${cleaned}`;
  }

  // Check that cleaned contains only digits and has valid international length (7 to 15 digits)
  if (!/^\d{7,15}$/.test(cleaned)) {
    throw AppError.badRequest(
      `Invalid phone number format: '${raw}'. Must be valid E.164 (7-15 digits).`,
      { raw },
    );
  }

  return `+${cleaned}`;
}

/**
 * Extracts recipient country code from an E.164 phone number.
 */
export function getCountryFromPhoneNumber(phone: string): string {
  const normalized = phone.replace(/^\+/, '');
  if (normalized.startsWith('91')) return 'IN';
  if (normalized.startsWith('1')) return 'US';
  if (normalized.startsWith('44')) return 'GB';
  if (normalized.startsWith('971')) return 'AE';
  if (normalized.startsWith('65')) return 'SG';
  return 'OTHER';
}
