export { baseLayout, type BaseLayoutOptions, type EmailBranding } from './base';
export {
  renderWelcomeEmail,
  type RenderWelcomeEmailOptions,
  type EmailTemplateResult,
} from './welcome';
export {
  renderPasswordResetEmail,
  type RenderPasswordResetEmailOptions,
} from './password-reset';
export { renderVerifyEmail, type RenderVerifyEmailOptions } from './verify-email';
export { renderMagicLinkEmail, type RenderMagicLinkEmailOptions } from './magic-link';
export { renderTenantInviteEmail, type RenderTenantInviteEmailOptions } from './tenant-invite';
export {
  renderStaffCredentialsEmail,
  type RenderStaffCredentialsEmailOptions,
} from './staff-credentials';
