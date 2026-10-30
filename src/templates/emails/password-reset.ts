import { baseLayout, type EmailBranding } from './base';
import type { EmailTemplateResult } from './welcome';

export interface RenderPasswordResetEmailOptions {
  name?: string;
  token: string;
  resetUrl?: string;
  branding?: EmailBranding;
}

export function renderPasswordResetEmail({
  name,
  token,
  resetUrl,
  branding,
}: RenderPasswordResetEmailOptions): EmailTemplateResult {
  const primaryColor = branding?.primaryColor ?? '#4f46e5';
  const companyName = branding?.companyName;
  const subject = companyName ? `Reset your password for ${companyName}` : 'Reset your password';
  const previewText = 'Your password reset code and instructions.';

  const bodyContent = `
    <h2>Password Reset Request</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your password${companyName ? ` for <strong>${companyName}</strong>` : ''}. Use the verification token below to complete the reset process:</p>
    
    <div class="token-box" style="background-color: ${branding?.secondaryColor || '#f8fafc'}; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Reset Token</div>
      <div class="token-code" style="font-family: monospace; font-size: 20px; font-weight: bold; color: ${primaryColor}; letter-spacing: 2px;">${token}</div>
    </div>

    ${
      resetUrl
        ? `<div style="text-align: center;"><a href="${resetUrl}" class="button" style="background-color: ${primaryColor}; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password</a></div>`
        : ''
    }

    <div class="notice">
      <p><strong>Security Notice:</strong> This code is valid for <strong>15 minutes</strong> and can only be used once.</p>
      <p>If you did not request a password reset, you can safely ignore this email — your account remains secure.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent, branding }),
  };
}
