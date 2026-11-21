import { baseLayout, type EmailBranding } from './base';
import type { EmailTemplateResult } from './welcome';

export interface RenderStaffInviteEmailOptions {
  name?: string;
  email: string;
  roleName: string;
  inviteUrl: string;
  message?: string;
  branding?: EmailBranding;
}

export function renderStaffInviteEmail({
  name,
  roleName,
  inviteUrl,
  message,
  branding,
}: RenderStaffInviteEmailOptions): EmailTemplateResult {
  const primaryColor = branding?.primaryColor ?? '#4f46e5';
  const companyName = branding?.companyName ?? 'Platform Team';
  const subject = `You're invited to join ${companyName} as ${roleName}`;
  const previewText = `You have been invited to join the platform team as ${roleName}. Complete your account setup inside.`;

  const bodyContent = `
    <h2>Platform Staff Invitation</h2>
    <p>Hi ${name || 'there'},</p>
    <p>You have been invited to join the <strong>${companyName}</strong> team with the <strong>${roleName}</strong> role.</p>
    
    ${
      message
        ? `<div style="background-color: #f1f5f9; border-left: 4px solid ${primaryColor}; padding: 12px 16px; margin: 20px 0; font-style: italic; color: #334155;">
             "${message}"
           </div>`
        : ''
    }

    <div style="text-align: center; margin: 28px 0;">
      <a href="${inviteUrl}" class="button" style="background-color: ${primaryColor}; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
        Accept Invitation & Set Password
      </a>
    </div>

    <div class="notice" style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
      <p><strong>Note:</strong> This invitation link is valid for <strong>7 days</strong>.</p>
      <p>If you did not expect this invitation, you can safely ignore this email.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent, branding }),
  };
}
