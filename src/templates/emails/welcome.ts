import { baseLayout, type EmailBranding } from './base';

export interface RenderWelcomeEmailOptions {
  name?: string;
  branding?: EmailBranding;
}

export interface EmailTemplateResult {
  subject: string;
  html: string;
}

export function renderWelcomeEmail({ name, branding }: RenderWelcomeEmailOptions): EmailTemplateResult {
  const companyName = branding?.companyName;
  const subject = companyName ? `Welcome to ${companyName}!` : 'Welcome aboard!';
  const previewText = companyName
    ? `Welcome to ${companyName}, ${name || 'there'}!`
    : `Welcome to the platform, ${name || 'there'}!`;

  const bodyContent = `
    <h2>Welcome aboard, ${name || 'there'}!</h2>
    <p>We're thrilled to have you join <strong>${companyName || 'our platform'}</strong>. Your account is ready, and you can now start exploring all features.</p>
    <p>If you have any questions or need assistance getting started, our team is always here to help.</p>
    <div class="notice">
      <p>Thank you for choosing ${companyName || 'our platform'}!</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent, branding }),
  };
}
