/**
 * Base email HTML layout with header/footer.
 *
 * Port of PocketBase's mails/templates/layout (Go -> TypeScript).
 * Layer 5 -- imports from ~/core/*.
 */

/**
 * Renders the base email HTML layout with the provided content
 * injected into the body.
 *
 * @param content - The inner HTML content (body).
 * @param appName - Optional application name (default: "Sinopebase").
 * @returns A complete HTML email document string.
 */
export function renderEmailLayout(content: string, appName: string = 'Sinopebase'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
        'Helvetica Neue', Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: #333333;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px 10px;
    }
    .email-header {
      text-align: center;
      padding: 20px 0;
      border-bottom: 2px solid #e0e0e0;
    }
    .email-header h1 {
      margin: 0;
      font-size: 24px;
      color: #222222;
    }
    .email-body {
      padding: 20px 0;
    }
    .email-footer {
      text-align: center;
      padding: 20px 0;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #999999;
    }
    .email-footer a {
      color: #666666;
      text-decoration: none;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <!-- Header -->
    <div class="email-header">
      <h1>${escapeHtml(appName)}</h1>
    </div>

    <!-- Body -->
    <div class="email-body">
      ${content}
    </div>

    <!-- Footer -->
    <div class="email-footer">
      <p>
        &copy; ${new Date().getFullYear()} ${escapeHtml(appName)}. All rights reserved.
      </p>
      <p>
        <a href="#">Privacy Policy</a> &middot;
        <a href="#">Terms of Service</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

/**
 * Escapes HTML special characters in a string.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
