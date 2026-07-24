/**
 * Record mail helpers — send verification, password reset, email change,
 * OTP, and login alert emails.
 *
 * Port of PocketBase's mails/record.go (Go -> TypeScript).
 * Layer 5 -- imports from ~/core/*, ~/mails/*, ~/tools/mailer.
 */

import type { Mailer } from '~/tools/mailer/mailer.ts'
import type { App } from '~/core/app.ts'
import { send } from './base.ts'
import { renderEmailLayout } from './templates/layout.ts'
import {
  verificationBody,
  passwordResetBody,
  confirmEmailChangeBody,
  otpBody,
  authAlertBody,
} from './templates/html_content.ts'

// ---------------------------------------------------------------------------
// App settings accessors (minimal helpers until full settings are ported)
// ---------------------------------------------------------------------------

interface AppSettingsAccessors {
  appName(): string
  appUrl(): string
  senderAddress(): string
  senderName(): string
}

/**
 * Default settings accessors — reads from process.env with sensible defaults.
 */
const defaultSettings: AppSettingsAccessors = {
  appName: () => process.env['APP_NAME'] ?? 'Sinopebase',
  appUrl: () => process.env['APP_URL'] ?? 'http://127.0.0.1:8090',
  senderAddress: () => process.env['SENDER_ADDRESS'] ?? 'noreply@sinopebase.dev',
  senderName: () => process.env['SENDER_NAME'] ?? 'Sinopebase',
}

// ---------------------------------------------------------------------------
// Mailer getter helper
// ---------------------------------------------------------------------------

/**
 * Resolve the mailer from the App interface.
 * Falls back to a no-op if none is configured.
 */
function resolveMailer(app: App): Mailer {
  // The app interface defines onMailerSend() but not a getMailer().
  // For now, we attempt to access it via any available channel.
  // In a full implementation the App would expose a mailer() method.
  const maybeMailer = (app as unknown as { mailer(): Mailer }).mailer
  if (typeof maybeMailer === 'function') {
    return maybeMailer()
  }
  throw new Error(
    'Mailer not available on App instance. ' +
    'Ensure the app has a configured SMTP or Sendmail mailer.',
  )
}

// ---------------------------------------------------------------------------
// sendVerificationEmail
// ---------------------------------------------------------------------------

/**
 * Sends a verification email to the provided email address.
 *
 * @param app - The App instance.
 * @param toEmail - The recipient's email address.
 * @param token - The verification token to include in the link.
 * @param settings - Optional settings overrides.
 */
export async function sendVerificationEmail(
  app: App,
  toEmail: string,
  token: string,
  settings?: Partial<AppSettingsAccessors>,
): Promise<void> {
  const s = { ...defaultSettings, ...settings }
  const htmlContent = verificationBody(s.appName(), s.appUrl(), token)
  const fullHtml = renderEmailLayout(htmlContent, s.appName())

  await send(
    resolveMailer(app),
    toEmail,
    `Verify your ${s.appName()} email`,
    fullHtml,
    s.senderAddress(),
    s.senderName(),
  )
}

// ---------------------------------------------------------------------------
// sendPasswordResetEmail
// ---------------------------------------------------------------------------

/**
 * Sends a password reset email to the provided email address.
 *
 * @param app - The App instance.
 * @param toEmail - The recipient's email address.
 * @param token - The password reset token to include in the link.
 * @param settings - Optional settings overrides.
 */
export async function sendPasswordResetEmail(
  app: App,
  toEmail: string,
  token: string,
  settings?: Partial<AppSettingsAccessors>,
): Promise<void> {
  const s = { ...defaultSettings, ...settings }
  const htmlContent = passwordResetBody(s.appName(), s.appUrl(), token)
  const fullHtml = renderEmailLayout(htmlContent, s.appName())

  await send(
    resolveMailer(app),
    toEmail,
    `Reset your ${s.appName()} password`,
    fullHtml,
    s.senderAddress(),
    s.senderName(),
  )
}

// ---------------------------------------------------------------------------
// sendEmailChangeEmail
// ---------------------------------------------------------------------------

/**
 * Sends an email change confirmation email.
 *
 * @param app - The App instance.
 * @param toEmail - The recipient's email address.
 * @param token - The email change token to include in the link.
 * @param settings - Optional settings overrides.
 */
export async function sendEmailChangeEmail(
  app: App,
  toEmail: string,
  token: string,
  settings?: Partial<AppSettingsAccessors>,
): Promise<void> {
  const s = { ...defaultSettings, ...settings }
  const htmlContent = confirmEmailChangeBody(s.appName(), s.appUrl(), token)
  const fullHtml = renderEmailLayout(htmlContent, s.appName())

  await send(
    resolveMailer(app),
    toEmail,
    `Confirm your ${s.appName()} new email address`,
    fullHtml,
    s.senderAddress(),
    s.senderName(),
  )
}

// ---------------------------------------------------------------------------
// sendOTPEmail
// ---------------------------------------------------------------------------

/**
 * Sends an OTP (one-time password) email.
 *
 * @param app - The App instance.
 * @param toEmail - The recipient's email address.
 * @param otp - The one-time password code.
 * @param settings - Optional settings overrides.
 */
export async function sendOTPEmail(
  app: App,
  toEmail: string,
  otp: string,
  settings?: Partial<AppSettingsAccessors>,
): Promise<void> {
  const s = { ...defaultSettings, ...settings }
  const htmlContent = otpBody(s.appName(), otp)
  const fullHtml = renderEmailLayout(htmlContent, s.appName())

  await send(
    resolveMailer(app),
    toEmail,
    `OTP for ${s.appName()}`,
    fullHtml,
    s.senderAddress(),
    s.senderName(),
  )
}

// ---------------------------------------------------------------------------
// sendLoginAlertEmail
// ---------------------------------------------------------------------------

/**
 * Sends a login alert email when a new device or location is detected.
 *
 * @param app - The App instance.
 * @param toEmail - The recipient's email address.
 * @param alertInfo - Human-readable description of the new login.
 * @param settings - Optional settings overrides.
 */
export async function sendLoginAlertEmail(
  app: App,
  toEmail: string,
  alertInfo: string,
  settings?: Partial<AppSettingsAccessors>,
): Promise<void> {
  const s = { ...defaultSettings, ...settings }
  const htmlContent = authAlertBody(s.appName(), alertInfo)
  const fullHtml = renderEmailLayout(htmlContent, s.appName())

  await send(
    resolveMailer(app),
    toEmail,
    'Login from a new location',
    fullHtml,
    s.senderAddress(),
    s.senderName(),
  )
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { AppSettingsAccessors }
