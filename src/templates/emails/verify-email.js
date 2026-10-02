import { baseLayout } from './base.js';

export function renderVerifyEmail({ name, token, verifyUrl }) {
  const subject = 'Verify your email address';
  const previewText = 'Confirm your email address to secure your account.';

  const bodyContent = `
    <h2>Verify Your Email Address</h2>
    <p>Hi ${name || 'there'},</p>
    <p>Please confirm your email address to complete your account setup and ensure the security of your profile:</p>

    <div class="token-box">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Verification Token</div>
      <div class="token-code">${token}</div>
    </div>

    ${
      verifyUrl
        ? `<div style="text-align: center;"><a href="${verifyUrl}" class="button">Verify Email Address</a></div>`
        : ''
    }

    <div class="notice">
      <p>This verification token is valid for <strong>24 hours</strong>.</p>
      <p>If you didn't create an account with us, please disregard this email.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent }),
  };
}
