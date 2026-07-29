/**
 * HTML email template strings ready for use with the layout.
 *
 * References templates from ~/core/collection_model_auth_templates.ts
 * for auth-related emails.
 *
 * Port of PocketBase's mails/templates/html_content.go (Go -> TypeScript).
 * Layer 5 -- imports from ~/core/*.
 */

// ---------------------------------------------------------------------------
// Re-export placeholders for convenience
// ---------------------------------------------------------------------------

export {
  EmailPlaceholderAppName,
  EmailPlaceholderAppUrl,
  EmailPlaceholderToken,
  EmailPlaceholderOtp,
  EmailPlaceholderOtpId,
  EmailPlaceholderAlertInfo,
} from '~/core/collection_model_auth_templates.ts'

// ---------------------------------------------------------------------------
// Verification email
// ---------------------------------------------------------------------------

/**
 * Returns the inner body HTML for a verification email.
 *
 * @param appName - Application name.
 * @param appUrl - Application base URL.
 * @param token - Verification token.
 * @returns HTML body string.
 */
export function verificationBody(appName: string, appUrl: string, token: string): string {
  const link = `${appUrl}/_/#/auth/confirm-verification/${token}`
  return `<p>Hello,</p>
<p>Thank you for registering with ${escapeHtml(appName)}.</p>
<p>Please verify your email address by clicking the button below:</p>
<p style="text-align:center;">
  <a href="${escapeHtml(link)}"
     class="button"
     style="background-color:#4CAF50;color:#ffffff;">
    Verify email
  </a>
</p>
<p>If you didn't register, please ignore this email.</p>
<p>
  Thanks,<br>
  ${escapeHtml(appName)} team
</p>`
}

// ---------------------------------------------------------------------------
// Password reset email
// ---------------------------------------------------------------------------

/**
 * Returns the inner body HTML for a password reset email.
 *
 * @param appName - Application name.
 * @param appUrl - Application base URL.
 * @param token - Password reset token.
 * @returns HTML body string.
 */
export function passwordResetBody(appName: string, appUrl: string, token: string): string {
  const link = `${appUrl}/_/#/auth/confirm-password-reset/${token}`
  return `<p>Hello,</p>
<p>Click the button below to reset your ${escapeHtml(appName)} password.</p>
<p style="text-align:center;">
  <a href="${escapeHtml(link)}"
     class="button"
     style="background-color:#2196F3;color:#ffffff;">
    Reset password
  </a>
</p>
<p>If you didn't request a password reset, please ignore this email.</p>
<p>
  Thanks,<br>
  ${escapeHtml(appName)} team
</p>`
}

// ---------------------------------------------------------------------------
// Email change confirmation
// ---------------------------------------------------------------------------

/**
 * Returns the inner body HTML for an email change confirmation email.
 *
 * @param appName - Application name.
 * @param appUrl - Application base URL.
 * @param token - Email change token.
 * @returns HTML body string.
 */
export function confirmEmailChangeBody(appName: string, appUrl: string, token: string): string {
  const link = `${appUrl}/_/#/auth/confirm-email-change/${token}`
  return `<p>Hello,</p>
<p>Click the button below to confirm your new email address for ${escapeHtml(appName)}.</p>
<p style="text-align:center;">
  <a href="${escapeHtml(link)}"
     class="button"
     style="background-color:#FF9800;color:#ffffff;">
    Confirm email change
  </a>
</p>
<p>If you didn't request an email change, please ignore this email.</p>
<p>
  Thanks,<br>
  ${escapeHtml(appName)} team
</p>`
}

// ---------------------------------------------------------------------------
// OTP email
// ---------------------------------------------------------------------------

/**
 * Returns the inner body HTML for an OTP email.
 *
 * @param appName - Application name.
 * @param otp - The one-time password code.
 * @returns HTML body string.
 */
export function otpBody(appName: string, otp: string): string {
  return `<p>Hello,</p>
<p>Your one-time password for ${escapeHtml(appName)} is:</p>
<p style="font-size:28px;font-weight:bold;text-align:center;letter-spacing:6px;margin:24px 0;">
  <strong>${escapeHtml(otp)}</strong>
</p>
<p>This code will expire in a few minutes.</p>
<p>If you didn't request this OTP, please ignore this email.</p>
<p>
  Thanks,<br>
  ${escapeHtml(appName)} team
</p>`
}

// ---------------------------------------------------------------------------
// Auth alert (new device login notification)
// ---------------------------------------------------------------------------

/**
 * Returns the inner body HTML for a login alert email.
 *
 * @param appName - Application name.
 * @param alertInfo - Human-readable information about the new login (device, location, etc.).
 * @returns HTML body string.
 */
export function authAlertBody(appName: string, alertInfo: string): string {
  return `<p>Hello,</p>
<p>We detected a login to your ${escapeHtml(appName)} account from a new device or location:</p>
<blockquote style="border-left:3px solid #e0e0e0;padding:10px 15px;margin:16px 0;color:#555555;">
  <em>${escapeHtml(alertInfo)}</em>
</blockquote>
<p><strong>If this wasn't you, please change your password immediately.</strong></p>
<p>If this was you, you can disregard this email.</p>
<p>
  Thanks,<br>
  ${escapeHtml(appName)} team
</p>`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
