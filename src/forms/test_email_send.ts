/**
 * TestEmailSend — validate and send a test email.
 *
 * Port of PocketBase forms/test_email_send.go (MIT license).
 * Layer 3 — imports from ~/tools/* and ~/core/*.
 *
 * Validates email settings and sends a test email using one of several
 * available templates.
 */

import { Type } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// Template constants
// ---------------------------------------------------------------------------

export const TestTemplateVerification = 'verification'
export const TestTemplatePasswordReset = 'password-reset'
export const TestTemplateEmailChange = 'email-change'
export const TestTemplateOTP = 'otp'
export const TestTemplateAuthAlert = 'login-alert'

/** All valid template identifiers. */
export const ValidTestTemplates = [
  TestTemplateVerification,
  TestTemplatePasswordReset,
  TestTemplateEmailChange,
  TestTemplateOTP,
  TestTemplateAuthAlert,
] as const

// ---------------------------------------------------------------------------
// Collection stub for validation
// ---------------------------------------------------------------------------

/**
 * Minimal collection interface for email test validation.
 */
export interface EmailTestCollectionStub {
  id: string
  name: string
  isAuth(): boolean
}

// ---------------------------------------------------------------------------
// TestEmailSend form
// ---------------------------------------------------------------------------

/**
 * TestEmailSend validates and sends a test email to verify
 * SMTP/mail configuration.
 */
export class TestEmailSend {
  /** Recipient email address. */
  email = ''

  /** Email template to use for the test. */
  template = ''

  /** Optional auth collection name/id (defaults to _superusers). */
  collection = ''

  /** Resolver to find auth collections by name or id. */
  protected collectionResolver: (nameOrId: string) => EmailTestCollectionStub | null

  /** Resolver to send the actual email. */
  protected emailSender: (params: {
    email: string
    template: string
    collection: EmailTestCollectionStub
  }) => Promise<void>

  /**
   * @param collectionResolver - Resolves collection name/id to collection stub.
   * @param emailSender        - Sends the test email.
   */
  constructor(
    collectionResolver?: (nameOrId: string) => EmailTestCollectionStub | null,
    emailSender?: (params: {
      email: string
      template: string
      collection: EmailTestCollectionStub
    }) => Promise<void>,
  ) {
    this.collectionResolver = collectionResolver ?? (() => null)
    this.emailSender =
      emailSender ??
      (async () => {
        throw new Error('No email sender configured')
      })
  }

  /**
   * TypeBox schema for form validation.
   */
  static schema = Type.Object({
    email: Type.String({
      minLength: 1,
      maxLength: 255,
      format: 'email',
    }),
    template: Type.String({
      minLength: 1,
      enum: [...ValidTestTemplates],
    }),
    collection: Type.Optional(
      Type.String({
        maxLength: 255,
      }),
    ),
  })

  /**
   * Validates the form data.
   *
   * Returns null if valid, or a map of field → error message.
   */
  validate(): Record<string, string> | null {
    const errors: Record<string, string> = {}

    // Email
    if (!this.email) {
      errors.email = 'Email is required'
    } else if (this.email.length > 255) {
      errors.email = 'Email must be at most 255 characters'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      errors.email = 'Invalid email format'
    }

    // Template
    if (!this.template) {
      errors.template = 'Template is required'
    } else if (!(ValidTestTemplates as readonly string[]).includes(this.template)) {
      errors.template = `Template must be one of: ${ValidTestTemplates.join(', ')}`
    }

    // Collection (optional)
    if (this.collection) {
      if (this.collection.length > 255) {
        errors.collection = 'Collection must be at most 255 characters'
      } else {
        const c = this.collectionResolver(this.collection)
        if (!c?.isAuth()) {
          errors.collection = 'Must be a valid auth collection id or name'
        }
      }
    }

    return Object.keys(errors).length > 0 ? errors : null
  }

  /**
   * Submits the form: validates and attempts to send a test email.
   *
   * Returns null on success, or an error message on failure.
   */
  async submit(): Promise<string | null> {
    const errors = this.validate()
    if (errors) {
      return Object.values(errors).join('; ')
    }

    // Resolve collection
    const collectionIdOrName = this.collection || '_superusers'
    const collection = this.collectionResolver(collectionIdOrName)
    if (!collection) {
      return `Failed to find collection "${collectionIdOrName}"`
    }

    try {
      await this.emailSender({
        email: this.email,
        template: this.template,
        collection,
      })
      return null
    } catch (err) {
      return `Failed to send test email: ${(err as Error).message}`
    }
  }
}
