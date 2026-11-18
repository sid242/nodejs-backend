import type {
  NotificationCategory,
  NotificationDigest,
  NotificationSeverity,
} from './notifications.dto';

export interface NotificationTypeDefinition {
  type: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  titleTemplate: string;
  defaultInApp: boolean;
  defaultEmail: boolean;
  defaultPush: boolean;
  defaultDigest: NotificationDigest;
  isCritical?: boolean; // Cannot be disabled on email/in-app for security/compliance
  description: string;
}

export const NOTIFICATION_CATALOG: Record<string, NotificationTypeDefinition> = {
  // Security
  'security.new_login': {
    type: 'security.new_login',
    category: 'SECURITY',
    severity: 'WARNING',
    titleTemplate: 'New sign-in detected on your account',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    isCritical: true,
    description: 'Triggered when a login occurs from a new device, browser, or IP address',
  },
  'security.password_changed': {
    type: 'security.password_changed',
    category: 'SECURITY',
    severity: 'INFO',
    titleTemplate: 'Your password was changed',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    isCritical: true,
    description: 'Triggered when the user password is updated',
  },
  'security.2fa_updated': {
    type: 'security.2fa_updated',
    category: 'SECURITY',
    severity: 'SUCCESS',
    titleTemplate: 'Two-factor authentication settings updated',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    isCritical: true,
    description: 'Triggered when 2FA is enabled or disabled',
  },

  // Team & Workspace
  'team.member_invited': {
    type: 'team.member_invited',
    category: 'TEAM',
    severity: 'INFO',
    titleTemplate: 'You have been invited to join {{workspaceName}}',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when an invitation to a workspace is sent',
  },
  'team.member_joined': {
    type: 'team.member_joined',
    category: 'TEAM',
    severity: 'SUCCESS',
    titleTemplate: '{{memberName}} has joined {{workspaceName}}',
    defaultInApp: true,
    defaultEmail: false,
    defaultPush: false,
    defaultDigest: 'DAILY',
    description: 'Triggered when an invited member accepts and joins',
  },
  'team.member_removed': {
    type: 'team.member_removed',
    category: 'TEAM',
    severity: 'WARNING',
    titleTemplate: 'Your membership in {{workspaceName}} was ended',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    isCritical: true,
    description: 'Triggered when a member is removed from a workspace',
  },
  'team.role_changed': {
    type: 'team.role_changed',
    category: 'TEAM',
    severity: 'INFO',
    titleTemplate: 'Your role in {{workspaceName}} was updated to {{roleName}}',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when a member role or permission changes',
  },

  // Billing
  'billing.invoice_created': {
    type: 'billing.invoice_created',
    category: 'BILLING',
    severity: 'INFO',
    titleTemplate: 'New invoice #{{invoiceNumber}} is available',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when a recurring or one-off billing invoice is generated',
  },
  'billing.payment_failed': {
    type: 'billing.payment_failed',
    category: 'BILLING',
    severity: 'CRITICAL',
    titleTemplate: 'Payment failed for {{workspaceName}}',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: true,
    defaultDigest: 'NONE',
    isCritical: true,
    description: 'Triggered when subscription billing payment attempt fails',
  },
  'billing.trial_expiring': {
    type: 'billing.trial_expiring',
    category: 'BILLING',
    severity: 'WARNING',
    titleTemplate: 'Your trial for {{workspaceName}} ends in {{daysRemaining}} days',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when workspace trial is nearing expiration',
  },
  'billing.limit_nearing': {
    type: 'billing.limit_nearing',
    category: 'BILLING',
    severity: 'WARNING',
    titleTemplate: 'Workspace usage reached {{usagePercent}}% of plan limit for {{feature}}',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when seat or feature quota reaches 80% or 90%',
  },

  // Files
  'files.ready': {
    type: 'files.ready',
    category: 'FILES',
    severity: 'SUCCESS',
    titleTemplate: 'File {{filename}} is ready for download',
    defaultInApp: true,
    defaultEmail: false,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when asynchronous file processing or export finishes',
  },
  'files.scan_failed': {
    type: 'files.scan_failed',
    category: 'FILES',
    severity: 'CRITICAL',
    titleTemplate: 'Security threat detected in {{filename}}',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    isCritical: true,
    description: 'Triggered when a file scan detects malware or corruption',
  },

  // Account & Privacy
  'account.export_ready': {
    type: 'account.export_ready',
    category: 'ACCOUNT',
    severity: 'SUCCESS',
    titleTemplate: 'Your account data export is ready for download',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Triggered when GDPR/CCPA data export archive is ready',
  },

  // System & Platform
  'system.announcement': {
    type: 'system.announcement',
    category: 'SYSTEM',
    severity: 'INFO',
    titleTemplate: 'Platform Announcement: {{title}}',
    defaultInApp: true,
    defaultEmail: false,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'Broadcast announcement sent by platform administration',
  },
  'system.maintenance': {
    type: 'system.maintenance',
    category: 'SYSTEM',
    severity: 'WARNING',
    titleTemplate: 'Scheduled platform maintenance on {{date}}',
    defaultInApp: true,
    defaultEmail: true,
    defaultPush: false,
    defaultDigest: 'NONE',
    description: 'System maintenance window notice',
  },
};

export function getCatalogEntry(type: string): NotificationTypeDefinition | undefined {
  return NOTIFICATION_CATALOG[type];
}

export function getDefaultPreferencesForCategory(category: NotificationCategory) {
  const isSecurityOrBilling = category === 'SECURITY' || category === 'BILLING';
  return {
    category,
    channelInApp: true,
    channelEmail: true,
    channelPush: false,
    digest: isSecurityOrBilling ? ('NONE' as const) : ('NONE' as const),
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: 'UTC',
  };
}
