import { baseLayout } from './base.js';
import type { EmailTemplateResult } from './welcome.js';

export interface RenderTenantInviteEmailOptions {
  name?: string;
  tenantName: string;
  roleName: string;
  token: string;
  inviteUrl?: string;
}

export function renderTenantInviteEmail({
  name,
  tenantName,
  roleName,
  token,
  inviteUrl,
}: RenderTenantInviteEmailOptions): EmailTemplateResult {
  const subject = `You're invited to join ${tenantName}`;
  const previewText = `Join ${tenantName} as ${roleName}.`;

  const bodyContent = `
    <h2>You're invited to join ${tenantName}</h2>
    <p>Hi ${name || 'there'},</p>
    <p>You have been invited to collaborate on <strong>${tenantName}</strong> with the <strong>${roleName}</strong> role.</p>
    
    ${
      inviteUrl
        ? `<div style="text-align: center; margin: 28px 0;">
             <a href="${inviteUrl}" class="button" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
               Accept Invitation & Join Workspace
             </a>
           </div>`
        : ''
    }

    <div class="token-box" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Invitation Token</div>
      <div class="token-code" style="font-family: monospace; font-size: 18px; font-weight: bold; color: #1e293b; letter-spacing: 2px;">${token}</div>
    </div>

    <div class="notice" style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px;">
      <p><strong>Note:</strong> This invitation link is valid for <strong>48 hours</strong>.</p>
      <p>If you were not expecting this invitation, you can ignore this email.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent }),
  };
}
