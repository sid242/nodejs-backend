export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
} as const;

export const ACCESS_TOKEN_COOKIE = COOKIE_NAMES.ACCESS_TOKEN;
export const REFRESH_TOKEN_COOKIE = COOKIE_NAMES.REFRESH_TOKEN;

export const COOKIE_PATHS = {
  ROOT: '/',
  AUTH: '/api/v1/auth',
} as const;

export const AUTH_HEADERS = {
  PREFIX: 'Bearer ',
  AUTHORIZATION: 'authorization',
} as const;

export const AUTH_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

export const TOKEN_EXPIRATION = {
  PASSWORD_RESET_SECONDS: 15 * 60, // 15 minutes
  EMAIL_VERIFICATION_SECONDS: 24 * 60 * 60, // 24 hours
  TWO_FACTOR_CHALLENGE_SECONDS: 5 * 60, // 5 minutes
  TWO_FACTOR_PENDING_SECONDS: 10 * 60, // 10 minutes to scan QR
} as const;

export const REDIS_PREFIXES = {
  REFRESH_TOKEN: 'rt:',
  PASSWORD_RESET: 'prt:',
  EMAIL_VERIFICATION: 'evt:',
  RATE_LIMIT: 'socket:rl:',
  USER_CACHE: 'user:',
  USERS_LIST_CACHE: 'users:list:',
  IMPERSONATION_SESSION: 'imp:session:',
  TWO_FACTOR_CHALLENGE: '2fa:challenge:',
  TWO_FACTOR_PENDING_SECRET: '2fa:pending:',
  PLATFORM_TWO_FACTOR_CHALLENGE: 'platform:2fa:challenge:',
  PLATFORM_TWO_FACTOR_PENDING_SECRET: 'platform:2fa:pending:',
} as const;

export const AUTH_MESSAGES = {
  EMAIL_NOT_VERIFIED: 'Email not verified. Please verify your email before logging in.',
  INVALID_CREDENTIALS: 'Invalid email or password',
  LOGGED_IN: 'Logged in',
  REGISTERED: 'Registered',
  TOKEN_REFRESHED: 'Token refreshed',
  LOGGED_OUT: 'Logged out successfully',
  PASSWORD_RESET_SENT: 'If that email is registered, password reset instructions have been sent.',
  PASSWORD_RESET_SUCCESS:
    'Password has been reset successfully. Please log in with your new password.',
  VERIFICATION_EMAIL_SENT:
    'If that email is registered and unverified, a verification email has been sent.',
  EMAIL_VERIFIED_SUCCESS: 'Email verified successfully.',
  EMAIL_ALREADY_VERIFIED: 'Email is already verified',
  REFRESH_TOKEN_REQUIRED: 'Refresh token is required',
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  REFRESH_TOKEN_REVOKED: 'Refresh token revoked or already used',
  IMPERSONATION_STARTED: 'Impersonation session started successfully',
  IMPERSONATION_STOPPED: 'Impersonation session stopped successfully',
  IMPERSONATION_REVOKED: 'Impersonation session has expired or was revoked',
  CANNOT_IMPERSONATE_SELF: 'Cannot impersonate yourself',
  CANNOT_IMPERSONATE_ADMIN: 'Cannot impersonate an administrator',
  NOT_IMPERSONATING: 'Not currently in an active impersonation session',
  PASSWORD_CHANGED_SUCCESS: 'Password changed successfully.',
  CURRENT_PASSWORD_INCORRECT: 'Current password does not match.',
  NEW_PASSWORD_SAME: 'New password must be different from your current password.',
  TWO_FACTOR_REQUIRED: 'Two-factor authentication is required',
  TWO_FACTOR_INVALID_CODE: 'Invalid verification code',
  TWO_FACTOR_ALREADY_ENABLED: 'Two-factor authentication is already enabled',
  TWO_FACTOR_NOT_ENABLED: 'Two-factor authentication is not enabled',
  TWO_FACTOR_ENABLED_SUCCESS: 'Two-factor authentication enabled successfully',
  TWO_FACTOR_DISABLED_SUCCESS: 'Two-factor authentication disabled successfully',
  TWO_FACTOR_CHALLENGE_EXPIRED: 'Two-factor challenge has expired or is invalid',
} as const;
