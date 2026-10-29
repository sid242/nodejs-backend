import { baseLayout } from './base';
import type { EmailTemplateResult } from './welcome';

export interface RenderMagicLinkEmailOptions {
  name?: string;
  token: string;
  magicLinkUrl?: string;
}

export function renderMagicLinkEmail({
  name,
  token,
  magicLinkUrl,
}: RenderMagicLinkEmailOptions): EmailTemplateResult {
  const subject = 'Your Magic Sign-In Link';
  const previewText = 'Click the link to sign in to your account without a password.';

  const bodyContent = `
    <h2>Sign in with Magic Link</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to sign in to your account using a passwordless magic link.</p>
    
    ${
      magicLinkUrl
        ? `<div style="text-align: center; margin: 28px 0;">
             <a href="${magicLinkUrl}" class="button" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
               Sign In to Your Workspace
             </a>
           </div>`
        : ''
    }

    <div class="token-box" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Single-Use Security Token</div>
      <div class="token-code" style="font-family: monospace; font-size: 18px; font-weight: bold; color: #1e293b; letter-spacing: 2px;">${token}</div>
    </div>

    <div class="notice" style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px;">
      <p><strong>Security Notice:</strong> This magic link expires in <strong>15 minutes</strong> and can only be used once.</p>
      <p>If you did not request this link, no action is needed — your account remains completely secure.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent }),
  };
}
