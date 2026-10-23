export { baseLayout, type BaseLayoutOptions } from './base.js';
export {
  renderWelcomeEmail,
  type RenderWelcomeEmailOptions,
  type EmailTemplateResult,
} from './welcome.js';
export {
  renderPasswordResetEmail,
  type RenderPasswordResetEmailOptions,
} from './password-reset.js';
export { renderVerifyEmail, type RenderVerifyEmailOptions } from './verify-email.js';
export { renderMagicLinkEmail, type RenderMagicLinkEmailOptions } from './magic-link.js';
export { renderTenantInviteEmail, type RenderTenantInviteEmailOptions } from './tenant-invite.js';
export {
  renderStaffCredentialsEmail,
  type RenderStaffCredentialsEmailOptions,
} from './staff-credentials.js';
