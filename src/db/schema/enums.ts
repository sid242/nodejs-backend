import { pgEnum } from 'drizzle-orm/pg-core';

export const fileStatusEnum = pgEnum('FileStatus', ['PENDING', 'UPLOADED']);
export const fileScanStatusEnum = pgEnum('FileScanStatus', [
  'PENDING',
  'CLEAN',
  'INFECTED',
  'SKIPPED',
  'FAILED',
]);
export const fileVisibilityEnum = pgEnum('FileVisibility', ['PRIVATE', 'TENANT', 'PUBLIC_LINK']);

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

export const supportSessionModeEnum = pgEnum('SupportSessionMode', ['TENANT_SCOPED', 'AS_MEMBER']);

export const supportSessionScopeEnum = pgEnum('SupportSessionScope', [
  'READ_ONLY',
  'ASSIST',
  'FULL',
  'FULL_ADMIN',
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

export const emailDeliveryStatusEnum = pgEnum('EmailDeliveryStatus', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
]);

export const emailSuppressionReasonEnum = pgEnum('EmailSuppressionReason', [
  'BOUNCE',
  'COMPLAINT',
  'UNSUBSCRIBE',
  'MANUAL',
]);

export const addressOwnerTypeEnum = pgEnum('AddressOwnerType', ['USER', 'TENANT', 'MEMBER']);

export const addressTypeEnum = pgEnum('AddressType', [
  'HOME',
  'WORK',
  'BILLING',
  'SHIPPING',
  'REGISTERED',
  'BRANCH',
  'OTHER',
]);

export const userGroupScopeEnum = pgEnum('UserGroupScope', ['PLATFORM', 'TENANT']);

export const userGroupStatusEnum = pgEnum('UserGroupStatus', ['ACTIVE', 'ARCHIVED']);

export const outboxStatusEnum = pgEnum('OutboxStatus', [
  'PENDING',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
]);

export const notificationCategoryEnum = pgEnum('NotificationCategory', [
  'SECURITY',
  'ACCOUNT',
  'BILLING',
  'TEAM',
  'FILES',
  'SYSTEM',
  'PRODUCT',
]);

export const notificationSeverityEnum = pgEnum('NotificationSeverity', [
  'INFO',
  'SUCCESS',
  'WARNING',
  'CRITICAL',
]);

export const notificationDigestEnum = pgEnum('NotificationDigest', ['NONE', 'DAILY', 'WEEKLY']);

export const featureFlagTypeEnum = pgEnum('FeatureFlagType', ['BOOLEAN', 'PERCENT', 'VARIANT']);

export const featureFlagTargetEnum = pgEnum('FeatureFlagTarget', [
  'TENANT',
  'PLAN',
  'USER',
  'PERCENT',
  'ENV',
]);

export const announcementSeverityEnum = pgEnum('AnnouncementSeverity', [
  'INFO',
  'MAINTENANCE',
  'INCIDENT',
  'FEATURE',
]);

export const announcementAudienceEnum = pgEnum('AnnouncementAudience', [
  'ALL',
  'PLAN',
  'TENANT',
  'ROLE',
]);

export const announcementStatusEnum = pgEnum('AnnouncementStatus', [
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'ENDED',
]);

export const consentTypeEnum = pgEnum('ConsentType', ['TERMS', 'PRIVACY', 'MARKETING', 'COOKIES']);

export const dataExportScopeEnum = pgEnum('DataExportScope', ['USER', 'TENANT']);

export const dataExportStatusEnum = pgEnum('DataExportStatus', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const accountDeletionStatusEnum = pgEnum('AccountDeletionStatus', [
  'COOLING_PERIOD',
  'ANONYMIZED',
  'CANCELED',
]);

export const tenantTombstoneReasonEnum = pgEnum('TenantTombstoneReason', [
  'REQUESTED_BY_OWNER',
  'INACTIVITY',
  'TERMS_VIOLATION',
  'LEGAL',
]);

export const chatChannelTypeEnum = pgEnum('ChatChannelType', [
  'DIRECT',
  'GROUP',
  'PUBLIC',
  'PRIVATE',
]);

export const chatParticipantRoleEnum = pgEnum('ChatParticipantRole', ['OWNER', 'ADMIN', 'MEMBER']);

export const chatMessageTypeEnum = pgEnum('ChatMessageType', ['TEXT', 'SYSTEM']);
