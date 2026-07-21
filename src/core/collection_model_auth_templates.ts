/**
 * Default auth email templates — HTML strings for verification, password reset,
 * email change, OTP, and new-device login alerts.
 *
 * Port of PocketBase's core/collection_model_auth_templates.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/collection_model_auth_options.
 */

import { EmailTemplate } from '~/core/collection_model_auth_options.ts'

// ---------------------------------------------------------------------------
// Placeholder constants
// ---------------------------------------------------------------------------

export const EmailPlaceholderAppName = '{APP_NAME}'
export const EmailPlaceholderAppUrl = '{APP_URL}'
export const EmailPlaceholderToken = '{TOKEN}'
export const EmailPlaceholderOtp = '{OTP}'
export const EmailPlaceholderOtpId = '{OTP_ID}'
export const EmailPlaceholderAlertInfo = '{ALERT_INFO}'

// ---------------------------------------------------------------------------
// Default templates
// ---------------------------------------------------------------------------

/**
 * Default verification email template.
 * Asks the user to verify their email address by clicking a link.
 */
export const defaultVerificationTemplate: EmailTemplate = {
  subject: 'Verify your ' + EmailPlaceholderAppName + ' email',
  body: `<html>
<body>
  <p>Hello,</p>
  <p>Thank you for registering with ` + EmailPlaceholderAppName + `.</p>
  <p>
    <a href="` + EmailPlaceholderAppUrl + `/_/#/auth/confirm-verification/` + EmailPlaceholderToken + `"
       style="display:inline-block;padding:12px 24px;background-color:#4CAF50;color:#ffffff;text-decoration:none;border-radius:4px;">
      Verify email
    </a>
  </p>
  <p>If you didn't register, please ignore this email.</p>
  <p>
    Thanks,<br>
    ` + EmailPlaceholderAppName + ` team
  </p>
</body>
</html>`,
} as EmailTemplate

/**
 * Default password reset email template.
 * Provides a link to reset the user's password.
 */
export const defaultResetPasswordTemplate: EmailTemplate = {
  subject: 'Reset your ' + EmailPlaceholderAppName + ' password',
  body: `<html>
<body>
  <p>Hello,</p>
  <p>Click the button below to reset your ` + EmailPlaceholderAppName + ` password.</p>
  <p>
    <a href="` + EmailPlaceholderAppUrl + `/_/#/auth/confirm-password-reset/` + EmailPlaceholderToken + `"
       style="display:inline-block;padding:12px 24px;background-color:#2196F3;color:#ffffff;text-decoration:none;border-radius:4px;">
      Reset password
    </a>
  </p>
  <p>If you didn't request a password reset, please ignore this email.</p>
  <p>
    Thanks,<br>
    ` + EmailPlaceholderAppName + ` team
  </p>
</body>
</html>`,
} as EmailTemplate

/**
 * Default email change confirmation template.
 * Confirms the user's new email address.
 */
export const defaultConfirmEmailChangeTemplate: EmailTemplate = {
  subject: 'Confirm your ' + EmailPlaceholderAppName + ' new email address',
  body: `<html>
<body>
  <p>Hello,</p>
  <p>Click the button below to confirm your new email address for ` + EmailPlaceholderAppName + `.</p>
  <p>
    <a href="` + EmailPlaceholderAppUrl + `/_/#/auth/confirm-email-change/` + EmailPlaceholderToken + `"
       style="display:inline-block;padding:12px 24px;background-color:#FF9800;color:#ffffff;text-decoration:none;border-radius:4px;">
      Confirm email change
    </a>
  </p>
  <p>If you didn't request an email change, please ignore this email.</p>
  <p>
    Thanks,<br>
    ` + EmailPlaceholderAppName + ` team
  </p>
</body>
</html>`,
} as EmailTemplate

/**
 * Default OTP email template.
 * Delivers a one-time password code.
 */
export const defaultOtpTemplate: EmailTemplate = {
  subject: 'OTP for ' + EmailPlaceholderAppName,
  body: `<html>
<body>
  <p>Your one-time password for ` + EmailPlaceholderAppName + ` is:</p>
  <p style="font-size:24px;font-weight:bold;text-align:center;letter-spacing:4px;">
    <strong>` + EmailPlaceholderOtp + `</strong>
  </p>
  <p>If you didn't request this OTP, please ignore this email.</p>
  <p>
    Thanks,<br>
    ` + EmailPlaceholderAppName + ` team
  </p>
</body>
</html>`,
} as EmailTemplate

/**
 * Default login alert email template.
 * Notifies the user of a login from an unfamiliar device/location.
 */
export const defaultAuthAlertTemplate: EmailTemplate = {
  subject: 'Login from a new location',
  body: `<html>
<body>
  <p>Hello,</p>
  <p>We detected a login to your ` + EmailPlaceholderAppName + ` account from a new device or location:</p>
  <p><em>` + EmailPlaceholderAlertInfo + `</em></p>
  <p><strong>If this wasn't you, please change your password immediately.</strong></p>
  <p>If this was you, you can disregard this email.</p>
  <p>
    Thanks,<br>
    ` + EmailPlaceholderAppName + ` team
  </p>
</body>
</html>`,
} as EmailTemplate
