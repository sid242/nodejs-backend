export interface BaseLayoutOptions {
  title: string;
  previewText?: string;
  bodyContent: string;
}

/**
 * Base email layout wrapper providing responsive styling, card container, and footer.
 */
export function baseLayout({ title, previewText, bodyContent }: BaseLayoutOptions): string {
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
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: #0f172a;
      padding: 28px 36px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 36px;
      line-height: 1.6;
      font-size: 15px;
      color: #334155;
    }
    .content h2 {
      margin-top: 0;
      font-size: 18px;
      color: #0f172a;
    }
    .token-box {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      margin: 24px 0;
    }
    .token-code {
      font-family: monospace;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 2px;
      color: #2563eb;
    }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: #ffffff !important;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      margin: 16px 0;
    }
    .footer {
      padding: 24px 36px;
      background: #f8fafc;
      border-top: 1px solid #f1f5f9;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
    }
    .notice {
      font-size: 13px;
      color: #64748b;
      margin-top: 20px;
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
              <h1>Antigravity Backend</h1>
            </div>
            <div class="content">
              ${bodyContent}
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Antigravity Backend. All rights reserved.</p>
              <p>This is an automated message, please do not reply directly to this email.</p>
            </div>
          </div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}
