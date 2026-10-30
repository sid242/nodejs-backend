export interface EmailBranding {
  companyName?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string | null;
  accentColor?: string | null;
  supportEmail?: string | null;
}

export interface BaseLayoutOptions {
  title: string;
  previewText?: string;
  bodyContent: string;
  branding?: EmailBranding;
}

/**
 * Base email layout wrapper providing responsive styling, card container, and footer.
 */
export function baseLayout({
  title,
  previewText,
  bodyContent,
  branding,
}: BaseLayoutOptions): string {
  const companyName = branding?.companyName ?? 'Scalable Platform';
  const primaryColor = branding?.primaryColor ?? '#4f46e5';
  const secondaryColor = branding?.secondaryColor ?? '#f8fafc';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f6f8;
      color: #1a1a1a;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f4f6f8;
      padding: 40px 0;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      border-top: 4px solid ${primaryColor};
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: #ffffff;
      padding: 32px 36px 20px 36px;
      text-align: center;
      border-bottom: 1px solid #f1f5f9;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: ${primaryColor};
      letter-spacing: -0.5px;
    }
    .content {
      padding: 32px 36px;
      line-height: 1.6;
      font-size: 15px;
      color: #334155;
    }
    .content h2 {
      margin-top: 0;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.3px;
    }
    .token-box {
      background: ${secondaryColor};
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      margin: 24px 0;
    }
    .token-code {
      font-family: monospace;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 2.5px;
      color: ${primaryColor};
    }
    .button {
      display: inline-block;
      background-color: ${primaryColor};
      color: #ffffff !important;
      padding: 12px 28px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      margin: 16px 0;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .footer {
      padding: 24px 36px;
      background: #f8fafc;
      border-top: 1px solid #f1f5f9;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
    .notice {
      font-size: 13px;
      color: #64748b;
      margin-top: 24px;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  ${previewText ? `<div style="display:none;font-size:1px;color:#f4f6f8;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${previewText}</div>` : ''}
  <div class="wrapper">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <div class="container">
            <div class="header">
              ${
                branding?.logoUrl
                  ? `<img src="${branding.logoUrl}" alt="${companyName}" height="38" style="display:block;margin:0 auto;max-height:38px;max-width:220px;object-fit:contain;border:0;" />`
                  : `<h1>${companyName}</h1>`
              }
            </div>
            <div class="content">
              ${bodyContent}
            </div>
            <div class="footer">
              <p style="margin:0 0 6px 0;">© ${new Date().getFullYear()} <strong>${companyName}</strong>. All rights reserved.</p>
              ${
                branding?.supportEmail
                  ? `<p style="margin:4px 0 0 0;">Questions? Contact us at <a href="mailto:${branding.supportEmail}" style="color:${primaryColor};font-weight:500;">${branding.supportEmail}</a></p>`
                  : '<p style="margin:4px 0 0 0;">This is an automated message, please do not reply directly to this email.</p>'
              }
            </div>
          </div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}
