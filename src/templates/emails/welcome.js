import { baseLayout } from './base.js';

export function renderWelcomeEmail({ name }) {
  const subject = 'Welcome aboard!';
  const previewText = `Welcome to the platform, ${name || 'there'}!`;

  const bodyContent = `
    <h2>Welcome aboard, ${name || 'there'}!</h2>
    <p>We're thrilled to have you join us. Your account is ready, and you can now start exploring all features.</p>
    <p>If you have any questions or need assistance getting started, our team is always here to help.</p>
    <div class="notice">
      <p>Thank you for choosing our platform!</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent }),
  };
}
