import { describe, it, expect } from 'bun:test'
import {
  defaultVerificationTemplate,
  defaultResetPasswordTemplate,
  defaultConfirmEmailChangeTemplate,
  defaultOtpTemplate,
  defaultAuthAlertTemplate,
  EmailPlaceholderAppName,
  EmailPlaceholderToken,
} from '~/core/collection_model_auth_templates.ts'
import { EmailTemplate } from '~/core/collection_model_auth_options.ts'

describe('Auth Templates', () => {
  it('defaultVerificationTemplate has subject and body', () => {
    expect(defaultVerificationTemplate.subject).toContain('Verify')
    expect(defaultVerificationTemplate.body).toContain(EmailPlaceholderAppName)
    expect(defaultVerificationTemplate.body).toContain(EmailPlaceholderToken)
  })

  it('defaultResetPasswordTemplate has subject and body', () => {
    expect(defaultResetPasswordTemplate.subject).toContain('Reset')
    expect(defaultResetPasswordTemplate.subject).toContain(EmailPlaceholderAppName)
  })

  it('defaultConfirmEmailChangeTemplate has subject and body', () => {
    expect(defaultConfirmEmailChangeTemplate.subject).toContain('Confirm')
    expect(defaultConfirmEmailChangeTemplate.subject).toContain('new email')
  })

  it('defaultOtpTemplate has OTP placeholder', () => {
    expect(defaultOtpTemplate.subject).toContain('OTP')
    expect(defaultOtpTemplate.body).toContain('{OTP}')
  })

  it('defaultAuthAlertTemplate has alert info placeholder', () => {
    expect(defaultAuthAlertTemplate.subject).toContain('Login')
    expect(defaultAuthAlertTemplate.body).toContain(EmailPlaceholderAppName)
    expect(defaultAuthAlertTemplate.body).toContain('{ALERT_INFO}')
  })

  it('EmailTemplate.resolve replaces placeholders', () => {
    const t = new EmailTemplate()
    t.subject = 'Hello {NAME}'
    t.body = '<p>Hi {NAME}</p>'
    const resolved = t.resolve({ '{NAME}': 'World' })
    expect(resolved.subject).toBe('Hello World')
    expect(resolved.body).toBe('<p>Hi World</p>')
    // Original is unchanged
    expect(t.subject).toBe('Hello {NAME}')
  })
})
