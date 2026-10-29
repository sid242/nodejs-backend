import { pgEnum } from 'drizzle-orm/pg-core';

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
  'PLATFORM_STAFF_INVITE',
]);

export const tenantStatusEnum = pgEnum('TenantStatus', [
  'ACTIVE',
  'SUSPENDED',
  'TRIALING',
  'DEACTIVATED',
]);

export const membershipStatusEnum = pgEnum('MembershipStatus', ['ACTIVE', 'INVITED', 'SUSPENDED']);

export const subscriptionStatusEnum = pgEnum('SubscriptionStatus', [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
]);

export const invitationStatusEnum = pgEnum('InvitationStatus', [
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED',
]);

export const platformStaffStatusEnum = pgEnum('PlatformStaffStatus', [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
]);

export const supportSessionStatusEnum = pgEnum('SupportSessionStatus', [
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
]);

export const supportSessionModeEnum = pgEnum('SupportSessionMode', [
  'TENANT_SCOPED',
  'AS_MEMBER',
]);

export const supportSessionScopeEnum = pgEnum('SupportSessionScope', [
  'READ_ONLY',
  'FULL',
]);

export const tenantDatabaseModeEnum = pgEnum('TenantDatabaseMode', ['shared', 'dedicated']);

export const customDomainStatusEnum = pgEnum('CustomDomainStatus', [
  'PENDING',
  'VERIFIED',
  'FAILED',
]);

export const actorTypeEnum = pgEnum('ActorType', ['USER', 'PLATFORM_STAFF', 'SYSTEM']);

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
