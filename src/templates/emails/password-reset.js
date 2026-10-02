import { baseLayout } from './base.js';

export function renderPasswordResetEmail({ name, token, resetUrl }) {
  const subject = 'Reset your password';
  const previewText = 'Your password reset code and instructions.';

  const bodyContent = `
    <h2>Password Reset Request</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your password. Use the verification token below to complete the reset process:</p>
    
    <div class="token-box">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">Reset Token</div>
      <div class="token-code">${token}</div>
    </div>

    ${
      resetUrl
        ? `<div style="text-align: center;"><a href="${resetUrl}" class="button">Reset Password</a></div>`
        : ''
    }

    <div class="notice">
      <p><strong>Security Notice:</strong> This code is valid for <strong>15 minutes</strong> and can only be used once.</p>
      <p>If you did not request a password reset, you can safely ignore this email — your account remains secure.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent }),
  };
}
