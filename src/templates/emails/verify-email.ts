import { baseLayout, type EmailBranding } from './base';
import type { EmailTemplateResult } from './welcome';

export interface RenderVerifyEmailOptions {
  name?: string;
  token: string;
  verifyUrl?: string;
  branding?: EmailBranding;
}

export function renderVerifyEmail({
  name,
  token,
  verifyUrl,
  branding,
}: RenderVerifyEmailOptions): EmailTemplateResult {
  const primaryColor = branding?.primaryColor ?? '#4f46e5';
  const companyName = branding?.companyName;
  const subject = companyName ? `Verify your email address for ${companyName}` : 'Verify your email address';
  const previewText = 'Confirm your email address to secure your account.';

  const bodyContent = `
    <h2>Verify Your Email Address</h2>
    <p>Hi ${name || 'there'},</p>
    <p>Please confirm your email address to complete your account setup${companyName ? ` for <strong>${companyName}</strong>` : ''} and ensure the security of your profile:</p>

    <div class="token-box" style="background-color: ${branding?.secondaryColor || '#f8fafc'}; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Verification Token</div>
      <div class="token-code" style="font-family: monospace; font-size: 20px; font-weight: bold; color: ${primaryColor}; letter-spacing: 2px;">${token}</div>
    </div>

    ${
      verifyUrl
        ? `<div style="text-align: center;"><a href="${verifyUrl}" class="button" style="background-color: ${primaryColor}; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Verify Email Address</a></div>`
        : ''
    }

    <div class="notice">
      <p>This verification token is valid for <strong>24 hours</strong>.</p>
      <p>If you didn't create an account with us, please disregard this email.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent, branding }),
  };
}
