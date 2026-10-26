import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('Role', ['USER', 'ADMIN']);
export const fileStatusEnum = pgEnum('FileStatus', ['PENDING', 'UPLOADED']);

export const userStatusEnum = pgEnum('UserStatus', [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
]);

export const verificationTokenTypeEnum = pgEnum('VerificationTokenType', [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'EMAIL_CHANGE',
  'PHONE_OTP',
  'MAGIC_LINK',
  'TWO_FACTOR_CHALLENGE',
]);

export const tenantStatusEnum = pgEnum('TenantStatus', [
  'ACTIVE',
  'SUSPENDED',
  'TRIALING',
  'DEACTIVATED',
]);

export const membershipStatusEnum = pgEnum('MembershipStatus', ['ACTIVE', 'INVITED', 'SUSPENDED']);

export const emailTemplateCategoryEnum = pgEnum('EmailTemplateCategory', [
  'MARKETING',
  'TRANSACTIONAL',
  'NOTIFICATION',
  'CUSTOM',
]);

export const emailTemplateStatusEnum = pgEnum('EmailTemplateStatus', [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
]);
