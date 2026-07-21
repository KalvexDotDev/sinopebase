/**
 * Auth collection options — configuration for "auth" type collections.
 *
 * Port of PocketBase's core/collection_model_auth_options.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/security.
 */

import { RandomString } from '~/tools/security/random.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum secret length for token configs. */
const MinSecretLength = 30

/** Maximum secret length for token configs. */
const MaxSecretLength = 255

// ---------------------------------------------------------------------------
// TokenConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for a JWT token type.
 *
 * Each auth token type (auth, verification, password reset, etc.) has
 * its own secret and duration.
 */
export class TokenConfig {
  /** HMAC secret for signing tokens (length 30-255). */
  secret: string = ''

  /** Token lifetime in seconds. */
  duration: number = 0

  /**
   * Returns the duration as a number of milliseconds.
   */
  durationMs(): number {
    return this.duration * 1000
  }

  /**
   * Validates the token configuration.
   *
   * @returns An array of error messages (empty if valid).
   */
  validate(): string[] {
    const errors: string[] = []

    if (this.secret.length < MinSecretLength || this.secret.length > MaxSecretLength) {
      errors.push(`secret: must be between ${MinSecretLength} and ${MaxSecretLength} characters`)
    }

    if (this.duration < 10 || this.duration > 31536000) {
      errors.push('duration: must be between 10 seconds and ~365 days')
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      secret: this.secret,
      duration: this.duration,
    }
  }

  static fromJSON(data: Record<string, unknown>): TokenConfig {
    const cfg = new TokenConfig()
    if (typeof data.secret === 'string') cfg.secret = data.secret
    if (typeof data.duration === 'number') cfg.duration = data.duration
    return cfg
  }

  /**
   * Creates a TokenConfig with a random secret.
   */
  static withRandomSecret(duration: number): TokenConfig {
    const cfg = new TokenConfig()
    cfg.secret = RandomString(50)
    cfg.duration = duration
    return cfg
  }
}

// ---------------------------------------------------------------------------
// EmailTemplate
// ---------------------------------------------------------------------------

/**
 * An email template with subject and body (HTML).
 */
export class EmailTemplate {
  /** Email subject line. */
  subject: string = ''

  /** Email body (HTML). */
  body: string = ''

  /**
   * Resolves placeholders in the template.
   *
   * @param placeholders - A map of placeholder -> replacement value.
   * @returns A new EmailTemplate with placeholders replaced.
   */
  resolve(placeholders: Record<string, string>): EmailTemplate {
    let subject = this.subject
    let body = this.body

    for (const [key, value] of Object.entries(placeholders)) {
      subject = subject.split(key).join(value)
      body = body.split(key).join(value)
    }

    const t = new EmailTemplate()
    t.subject = subject
    t.body = body
    return t
  }

  validate(): string[] {
    const errors: string[] = []
    if (!this.subject) errors.push('subject: is required')
    if (!this.body) errors.push('body: is required')
    return errors
  }

  toJSON(): Record<string, unknown> {
    return { subject: this.subject, body: this.body }
  }

  static fromJSON(data: Record<string, unknown>): EmailTemplate {
    const t = new EmailTemplate()
    if (typeof data.subject === 'string') t.subject = data.subject
    if (typeof data.body === 'string') t.body = data.body
    return t
  }
}

// ---------------------------------------------------------------------------
// PasswordAuthConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for password-based authentication.
 */
export class PasswordAuthConfig {
  /** Whether password auth is enabled. */
  enabled: boolean = true

  /** Field names used for identity (e.g., email, username). */
  identityFields: string[] = ['email']

  validate(): string[] {
    const errors: string[] = []

    if (this.enabled) {
      // Deduplicate identity fields
      const unique = [...new Set(this.identityFields.map((f) => f.trim()).filter(Boolean))]
      this.identityFields = unique

      if (unique.length === 0) {
        errors.push('identityFields: at least one identity field is required when password auth is enabled')
      }
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      identityFields: [...this.identityFields],
    }
  }

  static fromJSON(data: Record<string, unknown>): PasswordAuthConfig {
    const cfg = new PasswordAuthConfig()
    if (typeof data.enabled === 'boolean') cfg.enabled = data.enabled
    if (Array.isArray(data.identityFields)) {
      cfg.identityFields = data.identityFields.map(String)
    }
    return cfg
  }
}

// ---------------------------------------------------------------------------
// MFAConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for multi-factor authentication.
 */
export class MFAConfig {
  /** Whether MFA is enabled. */
  enabled: boolean = false

  /** Duration in seconds for which an MFA check remains valid. */
  duration: number = 1800

  /** Optional rule/filter to restrict which records require MFA. */
  rule: string = ''

  validate(): string[] {
    const errors: string[] = []

    if (this.enabled) {
      if (this.duration < 10 || this.duration > 86400) {
        errors.push('duration: must be between 10 and 86400 seconds when MFA is enabled')
      }
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      duration: this.duration,
      rule: this.rule,
    }
  }

  static fromJSON(data: Record<string, unknown>): MFAConfig {
    const cfg = new MFAConfig()
    if (typeof data.enabled === 'boolean') cfg.enabled = data.enabled
    if (typeof data.duration === 'number') cfg.duration = data.duration
    if (typeof data.rule === 'string') cfg.rule = data.rule
    return cfg
  }
}

// ---------------------------------------------------------------------------
// OTPConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for one-time password authentication.
 */
export class OTPConfig {
  /** Whether OTP auth is enabled. */
  enabled: boolean = false

  /** OTP duration in seconds. */
  duration: number = 180

  /** OTP length (number of digits/characters). */
  length: number = 8

  /** Email template for OTP delivery. */
  template: EmailTemplate = new EmailTemplate()

  validate(): string[] {
    const errors: string[] = []

    if (this.enabled) {
      if (this.duration < 10 || this.duration > 86400) {
        errors.push('duration: must be between 10 and 86400 seconds when OTP is enabled')
      }
      if (this.length < 4 || this.length > 32) {
        errors.push('length: must be between 4 and 32 when OTP is enabled')
      }
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      duration: this.duration,
      length: this.length,
      template: this.template.toJSON(),
    }
  }

  static fromJSON(data: Record<string, unknown>): OTPConfig {
    const cfg = new OTPConfig()
    if (typeof data.enabled === 'boolean') cfg.enabled = data.enabled
    if (typeof data.duration === 'number') cfg.duration = data.duration
    if (typeof data.length === 'number') cfg.length = data.length
    if (data.template && typeof data.template === 'object') {
      cfg.template = EmailTemplate.fromJSON(data.template as Record<string, unknown>)
    }
    return cfg
  }
}

// ---------------------------------------------------------------------------
// OAuth2ProviderConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for a single OAuth2 provider (e.g., Google, GitHub).
 */
export class OAuth2ProviderConfig {
  /** Provider name (e.g., "google", "github"). */
  name: string = ''

  /** OAuth2 client ID. */
  clientId: string = ''

  /** OAuth2 client secret (redacted in JSON export). */
  clientSecret: string = ''

  /** Custom auth URL (optional, for self-hosted providers). */
  authUrl: string = ''

  /** Custom token URL (optional, for self-hosted providers). */
  tokenUrl: string = ''

  /** Custom user info URL (optional, for self-hosted providers). */
  userInfoUrl: string = ''

  /** Display name for the UI. */
  displayName: string = ''

  /** PKCE override (empty = use default based on provider). */
  pkce: boolean | null = null

  /** Extra provider-specific configuration. */
  extra: Record<string, string> = {}

  validate(): string[] {
    const errors: string[] = []

    if (!this.name) errors.push('name: is required')

    if (this.clientId && !this.clientSecret) {
      errors.push('clientSecret: is required when clientId is set')
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      clientId: this.clientId,
      clientSecret: '', // always redact in JSON export
      authUrl: this.authUrl,
      tokenUrl: this.tokenUrl,
      userInfoUrl: this.userInfoUrl,
      displayName: this.displayName,
      pkce: this.pkce,
      extra: { ...this.extra },
    }
  }

  static fromJSON(data: Record<string, unknown>): OAuth2ProviderConfig {
    const cfg = new OAuth2ProviderConfig()
    if (typeof data.name === 'string') cfg.name = data.name
    if (typeof data.clientId === 'string') cfg.clientId = data.clientId
    if (typeof data.clientSecret === 'string') cfg.clientSecret = data.clientSecret
    if (typeof data.authUrl === 'string') cfg.authUrl = data.authUrl
    if (typeof data.tokenUrl === 'string') cfg.tokenUrl = data.tokenUrl
    if (typeof data.userInfoUrl === 'string') cfg.userInfoUrl = data.userInfoUrl
    if (typeof data.displayName === 'string') cfg.displayName = data.displayName
    if (data.pkce === true || data.pkce === false) cfg.pkce = data.pkce
    if (data.extra && typeof data.extra === 'object') {
      cfg.extra = { ...data.extra } as Record<string, string>
    }
    return cfg
  }
}

// ---------------------------------------------------------------------------
// OAuth2Config
// ---------------------------------------------------------------------------

/**
 * Configuration for OAuth2 authentication.
 */
export class OAuth2Config {
  /** Whether OAuth2 auth is enabled. */
  enabled: boolean = false

  /** List of configured OAuth2 providers. */
  providers: OAuth2ProviderConfig[] = []

  /** Mapped fields from the OAuth2 provider to collection fields. */
  mappedFields: OAuth2KnownFields = new OAuth2KnownFields()

  validate(): string[] {
    const errors: string[] = []

    if (this.enabled) {
      // Check for duplicate provider names
      const names = this.providers.map((p) => p.name).filter(Boolean)
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
      if (duplicates.length > 0) {
        errors.push(`providers: duplicate provider names: ${[...new Set(duplicates)].join(', ')}`)
      }
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      providers: this.providers.map((p) => p.toJSON()),
      mappedFields: this.mappedFields.toJSON(),
    }
  }

  static fromJSON(data: Record<string, unknown>): OAuth2Config {
    const cfg = new OAuth2Config()
    if (typeof data.enabled === 'boolean') cfg.enabled = data.enabled
    if (Array.isArray(data.providers)) {
      cfg.providers = data.providers.map((p: unknown) =>
        OAuth2ProviderConfig.fromJSON(p as Record<string, unknown>),
      )
    }
    if (data.mappedFields && typeof data.mappedFields === 'object') {
      cfg.mappedFields = OAuth2KnownFields.fromJSON(data.mappedFields as Record<string, unknown>)
    }
    return cfg
  }
}

// ---------------------------------------------------------------------------
// OAuth2KnownFields
// ---------------------------------------------------------------------------

/**
 * Maps OAuth2 provider user fields to collection fields.
 */
export class OAuth2KnownFields {
  /** The field mapped to the OAuth2 user id. */
  id: string = ''

  /** The field mapped to the OAuth2 user name. */
  name: string = ''

  /** The field mapped to the OAuth2 username. */
  username: string = ''

  /** The field mapped to the OAuth2 avatar URL. */
  avatarUrl: string = ''

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      username: this.username,
      avatarUrl: this.avatarUrl,
    }
  }

  static fromJSON(data: Record<string, unknown>): OAuth2KnownFields {
    const f = new OAuth2KnownFields()
    if (typeof data.id === 'string') f.id = data.id
    if (typeof data.name === 'string') f.name = data.name
    if (typeof data.username === 'string') f.username = data.username
    if (typeof data.avatarUrl === 'string') f.avatarUrl = data.avatarUrl
    return f
  }
}

// ---------------------------------------------------------------------------
// AuthAlertConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for new-device login alerts.
 */
export class AuthAlertConfig {
  /** Whether login alerts are enabled. */
  enabled: boolean = true

  /** Email template for the alert. */
  template: EmailTemplate = new EmailTemplate()

  validate(): string[] {
    // Only validate template if it has been customized (non-empty subject)
    if (this.template.subject || this.template.body) {
      return this.template.validate()
    }
    return []
  }

  toJSON(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      template: this.template.toJSON(),
    }
  }

  static fromJSON(data: Record<string, unknown>): AuthAlertConfig {
    const cfg = new AuthAlertConfig()
    if (typeof data.enabled === 'boolean') cfg.enabled = data.enabled
    if (data.template && typeof data.template === 'object') {
      cfg.template = EmailTemplate.fromJSON(data.template as Record<string, unknown>)
    }
    return cfg
  }
}

// ---------------------------------------------------------------------------
// CollectionAuthOptions
// ---------------------------------------------------------------------------

/**
 * Options for "auth" type collections.
 *
 * Contains all authentication-related configuration: token settings,
 * OAuth2 providers, password auth, MFA, OTP, email templates, etc.
 */
export class CollectionAuthOptions {
  /** Rule for who can authenticate (record-level auth rule). */
  authRule: string = ''

  /** Rule for who can manage auth records (admin-like rule). */
  manageRule: string = ''

  /** Configuration for auth tokens (JWT). */
  authToken: TokenConfig = TokenConfig.withRandomSecret(432000) // 5 days

  /** Configuration for password reset tokens. */
  passwordResetToken: TokenConfig = TokenConfig.withRandomSecret(1800) // 30 min

  /** Configuration for email change tokens. */
  emailChangeToken: TokenConfig = TokenConfig.withRandomSecret(1800) // 30 min

  /** Configuration for verification tokens. */
  verificationToken: TokenConfig = TokenConfig.withRandomSecret(604800) // 7 days

  /** Configuration for file tokens. */
  fileToken: TokenConfig = TokenConfig.withRandomSecret(120) // 2 min

  /** Whether to allow only verified auth records to be authenticated. */
  verificationRequired: boolean = false

  /** Email template for verification. */
  verificationTemplate: EmailTemplate = new EmailTemplate()

  /** Email template for password reset. */
  resetPasswordTemplate: EmailTemplate = new EmailTemplate()

  /** Email template for email change confirmation. */
  confirmEmailChangeTemplate: EmailTemplate = new EmailTemplate()

  /** Configuration for password-based authentication. */
  passwordAuth: PasswordAuthConfig = new PasswordAuthConfig()

  /** Configuration for OAuth2 authentication. */
  oauth2: OAuth2Config = new OAuth2Config()

  /** Configuration for multi-factor authentication. */
  mfa: MFAConfig = new MFAConfig()

  /** Configuration for one-time password authentication. */
  otp: OTPConfig = new OTPConfig()

  /** Configuration for new-device login alerts. */
  authAlert: AuthAlertConfig = new AuthAlertConfig()

  validate(): string[] {
    const errors: string[] = [
      ...this.authToken.validate().map((e) => `authToken.${e}`),
      ...this.passwordResetToken.validate().map((e) => `passwordResetToken.${e}`),
      ...this.emailChangeToken.validate().map((e) => `emailChangeToken.${e}`),
      ...this.verificationToken.validate().map((e) => `verificationToken.${e}`),
      ...this.fileToken.validate().map((e) => `fileToken.${e}`),
      ...this.passwordAuth.validate().map((e) => `passwordAuth.${e}`),
      ...this.oauth2.validate().map((e) => `oauth2.${e}`),
      ...this.mfa.validate().map((e) => `mfa.${e}`),
      ...this.otp.validate().map((e) => `otp.${e}`),
      ...this.authAlert.validate().map((e) => `authAlert.${e}`),
    ]

    // Cross-field: MFA requires at least 2 auth methods
    if (this.mfa.enabled) {
      let enabledCount = 0
      if (this.passwordAuth.enabled) enabledCount++
      if (this.oauth2.enabled) enabledCount++
      if (this.otp.enabled) enabledCount++
      if (enabledCount < 2) {
        errors.push('mfa: requires at least 2 authentication methods to be enabled')
      }
    }

    return errors
  }

  toJSON(): Record<string, unknown> {
    return {
      authRule: this.authRule,
      manageRule: this.manageRule,
      authToken: this.authToken.toJSON(),
      passwordResetToken: this.passwordResetToken.toJSON(),
      emailChangeToken: this.emailChangeToken.toJSON(),
      verificationToken: this.verificationToken.toJSON(),
      fileToken: this.fileToken.toJSON(),
      verificationRequired: this.verificationRequired,
      verificationTemplate: this.verificationTemplate.toJSON(),
      resetPasswordTemplate: this.resetPasswordTemplate.toJSON(),
      confirmEmailChangeTemplate: this.confirmEmailChangeTemplate.toJSON(),
      passwordAuth: this.passwordAuth.toJSON(),
      oauth2: this.oauth2.toJSON(),
      mfa: this.mfa.toJSON(),
      otp: this.otp.toJSON(),
      authAlert: this.authAlert.toJSON(),
    }
  }

  static fromJSON(data: Record<string, unknown>): CollectionAuthOptions {
    const opts = new CollectionAuthOptions()

    if (typeof data.authRule === 'string') opts.authRule = data.authRule
    if (typeof data.manageRule === 'string') opts.manageRule = data.manageRule
    if (typeof data.verificationRequired === 'boolean') opts.verificationRequired = data.verificationRequired

    if (data.authToken && typeof data.authToken === 'object') {
      opts.authToken = TokenConfig.fromJSON(data.authToken as Record<string, unknown>)
    }
    if (data.passwordResetToken && typeof data.passwordResetToken === 'object') {
      opts.passwordResetToken = TokenConfig.fromJSON(data.passwordResetToken as Record<string, unknown>)
    }
    if (data.emailChangeToken && typeof data.emailChangeToken === 'object') {
      opts.emailChangeToken = TokenConfig.fromJSON(data.emailChangeToken as Record<string, unknown>)
    }
    if (data.verificationToken && typeof data.verificationToken === 'object') {
      opts.verificationToken = TokenConfig.fromJSON(data.verificationToken as Record<string, unknown>)
    }
    if (data.fileToken && typeof data.fileToken === 'object') {
      opts.fileToken = TokenConfig.fromJSON(data.fileToken as Record<string, unknown>)
    }

    if (data.verificationTemplate && typeof data.verificationTemplate === 'object') {
      opts.verificationTemplate = EmailTemplate.fromJSON(data.verificationTemplate as Record<string, unknown>)
    }
    if (data.resetPasswordTemplate && typeof data.resetPasswordTemplate === 'object') {
      opts.resetPasswordTemplate = EmailTemplate.fromJSON(data.resetPasswordTemplate as Record<string, unknown>)
    }
    if (data.confirmEmailChangeTemplate && typeof data.confirmEmailChangeTemplate === 'object') {
      opts.confirmEmailChangeTemplate = EmailTemplate.fromJSON(data.confirmEmailChangeTemplate as Record<string, unknown>)
    }
    if (data.passwordAuth && typeof data.passwordAuth === 'object') {
      opts.passwordAuth = PasswordAuthConfig.fromJSON(data.passwordAuth as Record<string, unknown>)
    }
    if (data.oauth2 && typeof data.oauth2 === 'object') {
      opts.oauth2 = OAuth2Config.fromJSON(data.oauth2 as Record<string, unknown>)
    }
    if (data.mfa && typeof data.mfa === 'object') {
      opts.mfa = MFAConfig.fromJSON(data.mfa as Record<string, unknown>)
    }
    if (data.otp && typeof data.otp === 'object') {
      opts.otp = OTPConfig.fromJSON(data.otp as Record<string, unknown>)
    }
    if (data.authAlert && typeof data.authAlert === 'object') {
      opts.authAlert = AuthAlertConfig.fromJSON(data.authAlert as Record<string, unknown>)
    }

    return opts
  }
}
