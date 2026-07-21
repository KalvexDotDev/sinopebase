import { describe, it, expect } from 'bun:test'
import {
  verificationBody,
  passwordResetBody,
  confirmEmailChangeBody,
  otpBody,
  authAlertBody,
  EmailPlaceholderAppName,
  EmailPlaceholderAppUrl,
  EmailPlaceholderToken,
  EmailPlaceholderOtp,
  EmailPlaceholderAlertInfo,
} from './html_content.ts'

describe('html_content email templates', () => {
  describe('verificationBody', () => {
    it('includes the verification link with token', () => {
      const html = verificationBody('TestApp', 'https://example.com', 'abc123')
      expect(html).toContain('TestApp')
      expect(html).toContain('https://example.com/_/#/auth/confirm-verification/abc123')
      expect(html).toContain('Verify email')
    })
  })

  describe('passwordResetBody', () => {
    it('includes the password reset link with token', () => {
      const html = passwordResetBody('TestApp', 'https://example.com', 'tok123')
      expect(html).toContain('TestApp')
      expect(html).toContain('https://example.com/_/#/auth/confirm-password-reset/tok123')
      expect(html).toContain('Reset password')
    })
  })

  describe('confirmEmailChangeBody', () => {
    it('includes the email change confirmation link', () => {
      const html = confirmEmailChangeBody('App', 'https://app.com', 'ectok')
      expect(html).toContain('https://app.com/_/#/auth/confirm-email-change/ectok')
      expect(html).toContain('Confirm email change')
    })
  })

  describe('otpBody', () => {
    it('includes the OTP code', () => {
      const html = otpBody('App', '123456')
      expect(html).toContain('123456')
      expect(html).toContain('one-time password')
    })
  })

  describe('authAlertBody', () => {
    it('includes the alert info', () => {
      const html = authAlertBody('App', 'Chrome on Windows')
      expect(html).toContain('Chrome on Windows')
      expect(html).toContain('new device or location')
    })
  })

  describe('re-exports', () => {
    it('re-exports EmailPlaceholderAppName', () => {
      expect(EmailPlaceholderAppName).toBe('{APP_NAME}')
    })
    it('re-exports EmailPlaceholderAppUrl', () => {
      expect(EmailPlaceholderAppUrl).toBe('{APP_URL}')
    })
    it('re-exports EmailPlaceholderToken', () => {
      expect(EmailPlaceholderToken).toBe('{TOKEN}')
    })
    it('re-exports EmailPlaceholderOtp', () => {
      expect(EmailPlaceholderOtp).toBe('{OTP}')
    })
    it('re-exports EmailPlaceholderAlertInfo', () => {
      expect(EmailPlaceholderAlertInfo).toBe('{ALERT_INFO}')
    })
  })
})
