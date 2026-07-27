/**
 * Token generation for records — auth tokens, file tokens, verification, etc.
 *
 * Port of PocketBase's core/record_tokens.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/security/jwt.
 */

import type { Record as RecordModel } from '~/core/record_model.ts'
import { NewJWT } from '~/tools/security/jwt.ts'

type TokenConfigKey =
  | 'authToken'
  | 'verificationToken'
  | 'passwordResetToken'
  | 'emailChangeToken'
  | 'fileToken'

// ---------------------------------------------------------------------------
// Token type constants
// ---------------------------------------------------------------------------

export const TokenTypeAuth = 'auth'
export const TokenTypeFile = 'file'
export const TokenTypeVerification = 'verification'
export const TokenTypePasswordReset = 'passwordReset'
export const TokenTypeEmailChange = 'emailChange'

// ---------------------------------------------------------------------------
// Token claim key constants
// ---------------------------------------------------------------------------

export const TokenClaimId = 'id'
export const TokenClaimType = 'type'
export const TokenClaimCollectionId = 'collectionId'
export const TokenClaimEmail = 'email'
export const TokenClaimNewEmail = 'newEmail'
export const TokenClaimRefreshable = 'refreshable'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NotAuthRecordError extends Error {
  constructor() {
    super('the record is not from an auth collection')
    this.name = 'NotAuthRecordError'
  }
}

export class MissingSigningKeyError extends Error {
  constructor() {
    super('missing or empty token signing key')
    this.name = 'MissingSigningKeyError'
  }
}

// ---------------------------------------------------------------------------
// Internal token builder
// ---------------------------------------------------------------------------

/**
 * Builds a signing key from the record's token key and the token-specific secret.
 */
function buildSigningKey(record: RecordModel, tokenSecret: string): string {
  return record.getString('tokenKey') + tokenSecret
}

function tokenSigningKey(record: RecordModel, tokenKey: TokenConfigKey): string {
  const secret = record.collection.isAuth()
    ? (record.collection.authOptions?.[tokenKey].secret ?? '')
    : ''
  return buildSigningKey(record, secret)
}

/**
 * Creates a signing key for auth tokens using the collection's auth token secret.
 */
function authSigningKey(record: RecordModel): string {
  return tokenSigningKey(record, 'authToken')
}

/**
 * Creates a signing key for verification tokens.
 */
function verificationSigningKey(record: RecordModel): string {
  return tokenSigningKey(record, 'verificationToken')
}

/**
 * Creates a signing key for password reset tokens.
 */
function passwordResetSigningKey(record: RecordModel): string {
  return tokenSigningKey(record, 'passwordResetToken')
}

/**
 * Creates a signing key for email change tokens.
 */
function emailChangeSigningKey(record: RecordModel): string {
  return tokenSigningKey(record, 'emailChangeToken')
}

/**
 * Creates a signing key for file tokens.
 */
function fileSigningKey(record: RecordModel): string {
  return tokenSigningKey(record, 'fileToken')
}

/**
 * Gets a token duration from auth options.
 */
function getTokenDuration(record: RecordModel, tokenKey: TokenConfigKey): number {
  return record.collection.isAuth()
    ? (record.collection.authOptions?.[tokenKey].duration ?? 3600)
    : 3600
}

// ---------------------------------------------------------------------------
// Internal token creation
// ---------------------------------------------------------------------------

/**
 * Creates a basic auth token with the given claims.
 */
async function newAuthToken(
  record: RecordModel,
  durationMs: number,
  refreshable: boolean,
): Promise<string> {
  if (!record.collection.isAuth()) {
    throw new NotAuthRecordError()
  }

  const key = authSigningKey(record)
  if (!key) {
    throw new MissingSigningKeyError()
  }

  const claims: Record<string, unknown> = {
    [TokenClaimId]: record.id,
    [TokenClaimType]: TokenTypeAuth,
    [TokenClaimCollectionId]: record.collection.id,
    [TokenClaimRefreshable]: refreshable,
  }

  return NewJWT(claims, key, durationMs)
}

// ---------------------------------------------------------------------------
// Public token generation methods
// ---------------------------------------------------------------------------

/**
 * Creates a new auth token with a custom duration.
 *
 * The token is NOT refreshable (use `newStaticAuthToken`).
 *
 * Equivalent to Go's `Record.NewStaticAuthToken(duration)`.
 */
export async function newStaticAuthToken(record: RecordModel, durationMs: number): Promise<string> {
  if (durationMs <= 0) {
    const durationSec = getTokenDuration(record, 'authToken')
    durationMs = durationSec * 1000
  }
  return newAuthToken(record, durationMs, false)
}

/**
 * Creates a new refreshable auth token.
 *
 * Equivalent to Go's `Record.NewAuthToken()`.
 */
export async function newAuthTokenForRecord(record: RecordModel): Promise<string> {
  const durationSec = getTokenDuration(record, 'authToken')
  return newAuthToken(record, durationSec * 1000, true)
}

/**
 * Creates a new verification token with the record's email in the claims.
 *
 * Equivalent to Go's `Record.NewVerificationToken()`.
 */
export async function newVerificationToken(record: RecordModel): Promise<string> {
  if (!record.collection.isAuth()) {
    throw new NotAuthRecordError()
  }

  const key = verificationSigningKey(record)
  if (!key) {
    throw new MissingSigningKeyError()
  }

  const durationSec = getTokenDuration(record, 'verificationToken')
  const claims: Record<string, unknown> = {
    [TokenClaimId]: record.id,
    [TokenClaimType]: TokenTypeVerification,
    [TokenClaimCollectionId]: record.collection.id,
    [TokenClaimEmail]: record.getString('email'),
  }

  return NewJWT(claims, key, durationSec * 1000)
}

/**
 * Creates a new password reset token.
 *
 * Equivalent to Go's `Record.NewPasswordResetToken()`.
 */
export async function newPasswordResetToken(record: RecordModel): Promise<string> {
  if (!record.collection.isAuth()) {
    throw new NotAuthRecordError()
  }

  const key = passwordResetSigningKey(record)
  if (!key) {
    throw new MissingSigningKeyError()
  }

  const durationSec = getTokenDuration(record, 'passwordResetToken')
  const claims: Record<string, unknown> = {
    [TokenClaimId]: record.id,
    [TokenClaimType]: TokenTypePasswordReset,
    [TokenClaimCollectionId]: record.collection.id,
    [TokenClaimEmail]: record.getString('email'),
  }

  return NewJWT(claims, key, durationSec * 1000)
}

/**
 * Creates a new email change token.
 *
 * Equivalent to Go's `Record.NewEmailChangeToken(newEmail)`.
 */
export async function newEmailChangeToken(record: RecordModel, newEmail: string): Promise<string> {
  if (!record.collection.isAuth()) {
    throw new NotAuthRecordError()
  }

  const key = emailChangeSigningKey(record)
  if (!key) {
    throw new MissingSigningKeyError()
  }

  const durationSec = getTokenDuration(record, 'emailChangeToken')
  const claims: Record<string, unknown> = {
    [TokenClaimId]: record.id,
    [TokenClaimType]: TokenTypeEmailChange,
    [TokenClaimCollectionId]: record.collection.id,
    [TokenClaimEmail]: record.getString('email'),
    [TokenClaimNewEmail]: newEmail,
  }

  return NewJWT(claims, key, durationSec * 1000)
}

/**
 * Creates a new file token for accessing protected files.
 *
 * Equivalent to Go's `Record.NewFileToken()`.
 */
export async function newFileToken(record: RecordModel): Promise<string> {
  if (!record.collection.isAuth()) {
    throw new NotAuthRecordError()
  }

  const key = fileSigningKey(record)
  if (!key) {
    throw new MissingSigningKeyError()
  }

  const durationSec = getTokenDuration(record, 'fileToken')
  const claims: Record<string, unknown> = {
    [TokenClaimId]: record.id,
    [TokenClaimType]: TokenTypeFile,
    [TokenClaimCollectionId]: record.collection.id,
  }

  return NewJWT(claims, key, durationSec * 1000)
}
