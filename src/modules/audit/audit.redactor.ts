/**
 * List of sensitive key substrings that must be redacted from audit log metadata and payloads.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'accesstoken',
  'rawtoken',
  'secret',
  'apikey',
  'privatekey',
  'authorization',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
  'certificate',
  'smtppassword',
  'databasesecretref',
  'authheader',
];

/**
 * Deeply redacts sensitive fields from any data payload or diff object.
 * Always handles null, undefined, arrays, and nested objects safely.
 */
export function redactSensitiveData<T = any>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (data instanceof Date) {
    return data;
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

