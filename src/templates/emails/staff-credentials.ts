import { baseLayout } from './base';
import type { EmailTemplateResult } from './welcome';

export interface RenderStaffCredentialsEmailOptions {
  name?: string;
  email: string;
  password?: string;
  roleName: string;
  loginUrl: string;
}

export function renderStaffCredentialsEmail({
  name,
  email,
  password,
  roleName,
  loginUrl,
}: RenderStaffCredentialsEmailOptions): EmailTemplateResult {
  const subject = `Welcome to the Platform Team — Your Access Credentials`;
  const previewText = `Your platform operator account is ready. Access credentials and sign-in link inside.`;

  const bodyContent = `
    <h2>Welcome to the Platform Team</h2>
    <p>Hi ${name || 'there'},</p>
    <p>An administrator has provisioned your platform staff account with the <strong>${roleName}</strong> role.</p>
    
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <div style="font-size: 12px; color: #64748b; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Account Credentials</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; width: 140px;"><strong>Email:</strong></td>
          <td style="padding: 6px 0; color: #1e293b; font-family: monospace;">${email}</td>
        </tr>
        ${
          password
            ? `<tr>
                 <td style="padding: 6px 0; color: #64748b;"><strong>Temporary Password:</strong></td>
                 <td style="padding: 6px 0; color: #1e293b; font-family: monospace; font-weight: bold; letter-spacing: 1px;">${password}</td>
               </tr>`
            : ''
        }
        <tr>
          <td style="padding: 6px 0; color: #64748b;"><strong>Assigned Role:</strong></td>
          <td style="padding: 6px 0; color: #1e293b;">${roleName}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${loginUrl}" class="button" style="background-color: #4f46e5; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
        Log In to Platform Portal
      </a>
    </div>

    <div class="notice" style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
      <p><strong>Security Tip:</strong> For security compliance, please sign in and change your password immediately after logging in for the first time.</p>
      <p>If you did not expect this invitation or believe this was done in error, please contact your security administrator immediately.</p>
    </div>
  `;

  return {
    subject,
    html: baseLayout({ title: subject, previewText, bodyContent }),
  };
}
