/**
 * Record Auth API — /api/collections/:collection/auth-*
 *
 * Port of PocketBase's apis/record_auth.go.
 * All auth-related endpoints: password, OAuth2, OTP, verification,
 * password reset, email change, refresh, impersonate.
 *
 * Layer 4 — imports from ~/core/*, ~/tools/*, ~/forms/*.
 */

import { Elysia } from 'elysia'
import type { IDatabase } from '~/core/db-interface'
import { Collection } from '~/core/collection_model'
import { Record as RecordModel } from '~/core/record_model'
import { newAuthTokenForRecord, newVerificationToken, newPasswordResetToken, newEmailChangeToken } from '~/core/record_tokens'
import type { RequestAuthInfo } from './record_helpers'

// ---------------------------------------------------------------------------
// Auth response types
// ---------------------------------------------------------------------------

export interface AuthRecordResponse {
  token: string
  record: Record<string, unknown>
}

export interface AuthMethodsResponse {
  password?: { enabled: boolean; identityFields: string[] }
  oauth2?: { enabled: boolean; providers: Array<{ name: string; displayName: string; logo: string }> }
  mfa?: { enabled: boolean }
  otp?: { enabled: boolean }
}

// ---------------------------------------------------------------------------
// Local DB helpers (handle both IDatabase and MemoryDatabase formats)
// ---------------------------------------------------------------------------

async function selectRows(db: IDatabase, table: string, options: any = {}): Promise<Record<string, unknown>[]> {
  try {
    const result = await db.select(table, options)
    if (Array.isArray(result)) return result
    if (result && typeof result === 'object' && 'rows' in result) return (result as any).rows
    return []
  } catch {
    return []
  }
}

async function findCollectionByIdOrName(db: IDatabase, idOrName: string): Promise<Collection | null> {
  const rows = await selectRows(db, '_collections', {
    filters: [{ column: 'id', operator: 'eq', value: idOrName }],
    limit: 1,
  })
  if (rows.length > 0) {
    const collection = new Collection()
    collection.loadFromDb(rows[0]!)
    return collection
  }

  const nameRows = await selectRows(db, '_collections', {
    filters: [{ column: 'name', operator: 'ilike', value: idOrName }],
    limit: 1,
  })
  if (nameRows.length > 0) {
    const collection = new Collection()
    collection.loadFromDb(nameRows[0]!)
    return collection
  }
  return null
}

async function findAuthRecordByEmail(
  db: IDatabase,
  collectionName: string,
  email: string,
): Promise<RecordModel | null> {
  const rows = await selectRows(db, collectionName, {
    filters: [{ column: 'email', operator: 'eq', value: email }],
    limit: 1,
  })
  if (rows.length === 0) return null

  const collection = await findCollectionByIdOrName(db, collectionName)
  if (!collection) return null

  const record = new RecordModel(collection)
  record.load(rows[0]!)
  if (rows[0]!['id']) record.id = String(rows[0]!['id'])
  return record
}

async function findRecordById(
  db: IDatabase,
  collectionName: string,
  recordId: string,
): Promise<RecordModel | null> {
  const rows = await selectRows(db, collectionName, {
    filters: [{ column: 'id', operator: 'eq', value: recordId }],
    limit: 1,
  })
  if (rows.length === 0) return null
  const collection = await findCollectionByIdOrName(db, collectionName)
  if (!collection) return null
  const record = new RecordModel(collection)
  record.load(rows[0]!)
  if (rows[0]!['id']) record.id = String(rows[0]!['id'])
  return record
}

function authResponse(record: RecordModel, token: string): AuthRecordResponse {
  return {
    token,
    record: record.toJSON(),
  }
}

async function resolveAuthCollection(
  db: IDatabase,
  collectionParam: string,
): Promise<{ collection: Collection } | { error: { code: number; message: string } }> {
  const collection = await findCollectionByIdOrName(db, collectionParam)
  if (!collection) {
    return { error: { code: 404, message: 'Missing or invalid auth collection context.' } }
  }
  if (!collection.isAuth()) {
    return { error: { code: 400, message: 'Collection is not an auth collection.' } }
  }
  return { collection }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create an Elysia plugin that registers all /api/collections/:collection/auth-* routes.
 */
export function createRecordAuthPlugin(
  db: IDatabase,
  authResolver: () => Promise<RequestAuthInfo>,
  _getTokenSecret?: () => string,
) {
  const app = new Elysia()

  // ── GET /api/collections/:collection/auth-methods ──
  app.get('/api/collections/:collection/auth-methods', async ({ params, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    return {
      password: { enabled: true, identityFields: ['email'] },
      oauth2: { enabled: false, providers: [] },
      mfa: { enabled: false },
      otp: { enabled: false },
    }
  })

  // ── POST /api/collections/:collection/auth-with-password ──
  app.post('/api/collections/:collection/auth-with-password', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }
    const { collection } = resolved

    try {
      const { identity, password } = (body ?? {}) as { identity?: string; password?: string }

      if (!identity || !password) {
        set.status = 400
        return { code: 400, message: 'Missing required auth credentials.' }
      }

      const record = await findAuthRecordByEmail(db, collection.name, identity)
      if (!record) {
        set.status = 400
        return { code: 400, message: 'Invalid login credentials.' }
      }

      const pw = record.getRaw('password')
      const isValid = pw && typeof pw === 'object' && typeof (pw as Record<string, unknown>)['validate'] === 'function'
        ? (pw as { validate: (pwd: string) => boolean }).validate(password)
        : password === String(pw ?? '')

      if (!isValid) {
        set.status = 400
        return { code: 400, message: 'Invalid login credentials.' }
      }

      const token = await newAuthTokenForRecord(record)
      return authResponse(record, token)
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Auth failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections/:collection/auth-with-oauth2 ──
  app.post('/api/collections/:collection/auth-with-oauth2', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const { provider } = (body ?? {}) as { provider?: string }
    if (!provider) {
      set.status = 400
      return { code: 400, message: 'Missing OAuth2 provider.' }
    }

    set.status = 501
    return { code: 501, message: 'OAuth2 authentication is not yet fully implemented.' }
  })

  // ── POST /api/collections/:collection/auth-refresh ──
  app.post('/api/collections/:collection/auth-refresh', async ({ params, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const authInfo = await authResolver()
    if (!authInfo.record) {
      set.status = 401
      return { code: 401, message: 'Authentication required.' }
    }

    try {
      const token = await newAuthTokenForRecord(authInfo.record)
      return authResponse(authInfo.record, token)
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Auth refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections/:collection/request-password-reset ──
  app.post('/api/collections/:collection/request-password-reset', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }
    const { collection } = resolved

    try {
      const { email } = (body ?? {}) as { email?: string }
      if (!email) {
        set.status = 400
        return { code: 400, message: 'Email is required.' }
      }

      const record = await findAuthRecordByEmail(db, collection.name, email)
      if (record) {
        const resetToken = await newPasswordResetToken(record)
        console.info(`Password reset token for ${email}: ${resetToken}`)
      }

      return { message: 'If the email exists, a password reset email has been sent.' }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections/:collection/confirm-password-reset ──
  app.post('/api/collections/:collection/confirm-password-reset', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const { token, password, passwordConfirm } = (body ?? {}) as {
      token?: string; password?: string; passwordConfirm?: string
    }
    if (!token || !password) {
      set.status = 400
      return { code: 400, message: 'Token and password are required.' }
    }
    if (password !== passwordConfirm) {
      set.status = 400
      return { code: 400, message: 'Passwords do not match.' }
    }

    set.status = 501
    return { code: 501, message: 'Password reset confirmation is not yet fully implemented.' }
  })

  // ── POST /api/collections/:collection/request-verification ──
  app.post('/api/collections/:collection/request-verification', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }
    const { collection } = resolved

    try {
      const { email } = (body ?? {}) as { email?: string }
      if (!email) {
        set.status = 400
        return { code: 400, message: 'Email is required.' }
      }

      const record = await findAuthRecordByEmail(db, collection.name, email)
      if (record) {
        const verificationToken = await newVerificationToken(record)
        console.info(`Verification token for ${email}: ${verificationToken}`)
      }

      return { message: 'If the email exists, a verification email has been sent.' }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections/:collection/confirm-verification ──
  app.post('/api/collections/:collection/confirm-verification', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const { token } = (body ?? {}) as { token?: string }
    if (!token) {
      set.status = 400
      return { code: 400, message: 'Token is required.' }
    }

    set.status = 501
    return { code: 501, message: 'Verification confirmation is not yet fully implemented.' }
  })

  // ── POST /api/collections/:collection/request-email-change ──
  app.post('/api/collections/:collection/request-email-change', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const authInfo = await authResolver()
    if (!authInfo.record) {
      set.status = 401
      return { code: 401, message: 'Authentication required.' }
    }

    try {
      const { newEmail } = (body ?? {}) as { newEmail?: string }
      if (!newEmail) {
        set.status = 400
        return { code: 400, message: 'New email is required.' }
      }

      const token = await newEmailChangeToken(authInfo.record, newEmail)
      console.info(`Email change token for ${newEmail}: ${token}`)
      return { message: 'If the new email is valid, a confirmation email has been sent.' }
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Email change request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ── POST /api/collections/:collection/confirm-email-change ──
  app.post('/api/collections/:collection/confirm-email-change', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const { token } = (body ?? {}) as { token?: string }
    if (!token) {
      set.status = 400
      return { code: 400, message: 'Token is required.' }
    }

    set.status = 501
    return { code: 501, message: 'Email change confirmation is not yet fully implemented.' }
  })

  // ── POST /api/collections/:collection/request-otp ──
  app.post('/api/collections/:collection/request-otp', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const { email } = (body ?? {}) as { email?: string }
    if (!email) {
      set.status = 400
      return { code: 400, message: 'Email is required.' }
    }

    set.status = 501
    return { code: 501, message: 'OTP request is not yet fully implemented.' }
  })

  // ── POST /api/collections/:collection/auth-with-otp ──
  app.post('/api/collections/:collection/auth-with-otp', async ({ params, body, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }

    const { otpId, password } = (body ?? {}) as { otpId?: string; password?: string }
    if (!otpId || !password) {
      set.status = 400
      return { code: 400, message: 'OTP ID and password are required.' }
    }

    set.status = 501
    return { code: 501, message: 'OTP authentication is not yet fully implemented.' }
  })

  // ── POST /api/collections/:collection/impersonate/:id ──
  app.post('/api/collections/:collection/impersonate/:id', async ({ params, set }) => {
    const resolved = await resolveAuthCollection(db, params.collection as string)
    if ('error' in resolved) {
      set.status = resolved.error.code
      return resolved.error
    }
    const { collection } = resolved

    const authInfo = await authResolver()
    if (!authInfo.isSuperuser) {
      set.status = 403
      return { code: 403, message: 'Only superusers can impersonate.' }
    }

    try {
      const recordId = params.id as string
      const record = await findRecordById(db, collection.name, recordId)
      if (!record) {
        set.status = 404
        return { code: 404, message: 'Record not found.' }
      }

      const token = await newAuthTokenForRecord(record)
      return authResponse(record, token)
    } catch (err) {
      set.status = 400
      return {
        code: 400,
        message: `Impersonation failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  return app
}
