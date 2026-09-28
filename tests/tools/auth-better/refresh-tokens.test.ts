// @new-code-test positive src/tools/auth-better/refresh-tokens.ts
// @new-code-test negative src/tools/auth-better/refresh-tokens.ts
/**
 * GoTrue-compatible refresh tokens and logout over real PostgreSQL: opaque
 * refresh tokens, rotation in a family, the reuse rules for concurrent or
 * lost refreshes, replay revocation and logout scopes.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  spyOn,
} from 'bun:test'
import type { Kysely } from 'kysely'
import pg from 'pg'
import { createRefreshTokensTable } from '~/tools/auth-better'
import {
  type BetterAuthDatabase,
  createAuthTables,
  createBetterAuthDB,
} from '~/tools/auth-better/adapter'
import {
  exchangeRefreshToken,
  REFRESH_TOKEN_REUSE_INTERVAL_MS,
  refreshTokenForSession,
  revokeSessions,
} from '~/tools/auth-better/refresh-tokens'
import { requirePostgres } from '../../harness'

const OPAQUE = /^[A-Za-z0-9_-]{43}$/
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const prefix = `rt-${crypto.randomUUID().slice(0, 8)}`

let pool: pg.Pool
let db: Kysely<BetterAuthDatabase>
let userId: string
let otherUserId: string

async function createUser(): Promise<string> {
  const id = crypto.randomUUID()
  await db
    .insertInto('user')
    .values({ id, email: `${prefix}-${id}@example.com` } as never)
    .execute()
  return id
}

async function createSession(
  owner = userId,
  expiresInMs = 60_000,
): Promise<{ id: string; token: string }> {
  const session = { id: crypto.randomUUID(), token: `${prefix}-${crypto.randomUUID()}` }
  await db
    .insertInto('session')
    .values({ ...session, userId: owner, expiresAt: new Date(Date.now() + expiresInMs) } as never)
    .execute()
  return session
}

function tokenRow(tokenId: string) {
  return db
    .selectFrom('refresh_tokens')
    .selectAll()
    .where('token_id', '=', tokenId)
    .executeTakeFirst()
}

function sessionRow(id: string) {
  return db.selectFrom('session').selectAll().where('id', '=', id).executeTakeFirst()
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: requirePostgres() })
  db = createBetterAuthDB(pool)
  await createAuthTables(db)
  await createRefreshTokensTable(db)
})

beforeEach(async () => {
  userId = await createUser()
  otherUserId = await createUser()
})

afterEach(() => {
  setSystemTime()
})

afterAll(async () => {
  await db.deleteFrom('user').where('email', 'like', `${prefix}-%`).execute()
  await db.destroy()
})

describe('refreshTokenForSession', () => {
  it('starts a family with an opaque token for a new session', async () => {
    const session = await createSession()
    const before = Date.now()
    const token = await refreshTokenForSession(db, session.token)

    expect(token).toMatch(OPAQUE)
    expect(token).not.toBe(session.token)
    const row = await tokenRow(token)
    expect(row).toMatchObject({
      user_id: userId,
      session_id: session.id,
      parent_token_id: null,
      consumed: false,
      compromised: false,
    })
    expect(row?.family_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row?.expires_at.getTime()).toBeGreaterThanOrEqual(before + WEEK_MS)
    expect(row?.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + WEEK_MS)
    expect(row?.created_at.getTime()).toBeGreaterThanOrEqual(before)
  })

  it("returns the session's newest active token instead of starting another family", async () => {
    const session = await createSession()
    const first = await refreshTokenForSession(db, session.token)
    expect(await refreshTokenForSession(db, session.token)).toBe(first)

    const newer = await refreshTokenForSession(db, (await createSession()).token)
    await db
      .updateTable('refresh_tokens')
      .set({ session_id: session.id, created_at: new Date(Date.now() + 1000) })
      .where('token_id', '=', newer)
      .execute()
    expect(await refreshTokenForSession(db, session.token)).toBe(newer)
  })

  for (const [name, change] of [
    ['consumed', { consumed: true }],
    ['compromised', { compromised: true }],
    ['expired', { expires_at: new Date(Date.now() - 1000) }],
  ] as const) {
    it(`does not hand out a ${name} token`, async () => {
      const session = await createSession()
      const first = await refreshTokenForSession(db, session.token)
      await db.updateTable('refresh_tokens').set(change).where('token_id', '=', first).execute()
      const next = await refreshTokenForSession(db, session.token)
      expect(next).not.toBe(first)
      expect(next).toMatch(OPAQUE)
    })
  }

  it('rejects an unknown or expired session token', async () => {
    await expect(refreshTokenForSession(db, 'unknown')).rejects.toThrow('Authentication failed')
    const expired = await createSession(userId, -1000)
    await expect(refreshTokenForSession(db, expired.token)).rejects.toThrow('Authentication failed')
  })
})

describe('exchangeRefreshToken', () => {
  it('rotates the refresh token in its family and the access token in the session', async () => {
    const session = await createSession()
    const initial = await refreshTokenForSession(db, session.token)

    const pair = await exchangeRefreshToken(db, initial)

    expect(pair?.accessToken).toMatch(OPAQUE)
    expect(pair?.refreshToken).toMatch(OPAQUE)
    expect(pair?.accessToken).not.toBe(session.token)
    expect(pair?.refreshToken).not.toBe(initial)
    expect((await sessionRow(session.id))?.token).toBe(pair?.accessToken as string)
    const parent = await tokenRow(initial)
    expect(parent?.consumed).toBe(true)
    expect(await tokenRow(pair?.refreshToken as string)).toMatchObject({
      parent_token_id: initial,
      family_id: parent?.family_id,
      session_id: session.id,
      user_id: userId,
      consumed: false,
      compromised: false,
    })
  })

  it('gives concurrent refreshes with the same token the same pair', async () => {
    const session = await createSession()
    const initial = await refreshTokenForSession(db, session.token)

    const results = await Promise.all([1, 2, 3].map(() => exchangeRefreshToken(db, initial)))

    expect(results[0]).not.toBeNull()
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    const children = await db
      .selectFrom('refresh_tokens')
      .select('token_id')
      .where('parent_token_id', '=', initial)
      .execute()
    expect(children).toHaveLength(1)
  })

  it('returns the current pair for the parent of the active token at any age (lost response)', async () => {
    const session = await createSession()
    const initial = await refreshTokenForSession(db, session.token)
    const pair = await exchangeRefreshToken(db, initial)
    setSystemTime(new Date(Date.now() + 60 * 60 * 1000))
    await db
      .updateTable('session')
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where('id', '=', session.id)
      .execute()

    expect(await exchangeRefreshToken(db, initial)).toEqual(pair)
  })

  it('allows an older token only within the reuse interval', async () => {
    const session = await createSession(userId, 10 * 60_000)
    const initial = await refreshTokenForSession(db, session.token)
    const second = await exchangeRefreshToken(db, initial)
    const third = await exchangeRefreshToken(db, second?.refreshToken as string)
    const child = await tokenRow(second?.refreshToken as string)
    const consumedAt = child?.created_at.getTime() as number

    setSystemTime(new Date(consumedAt + REFRESH_TOKEN_REUSE_INTERVAL_MS - 1))
    expect(await exchangeRefreshToken(db, initial)).toEqual(third)

    setSystemTime(new Date(consumedAt + REFRESH_TOKEN_REUSE_INTERVAL_MS))
    const audit = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await exchangeRefreshToken(db, initial)).toBeNull()
      expect(audit).toHaveBeenCalledWith(
        `[AUDIT] Refresh token reuse detected: family=${child?.family_id}, user=${userId}; session ended`,
      )
    } finally {
      audit.mockRestore()
    }
  })

  it('rejects reuse when the session expired or has no active token', async () => {
    const audit = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const expired = await createSession()
      const initial = await refreshTokenForSession(db, expired.token)
      await exchangeRefreshToken(db, initial)
      await db
        .updateTable('session')
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where('id', '=', expired.id)
        .execute()
      expect(await exchangeRefreshToken(db, initial)).toBeNull()

      const orphaned = await createSession()
      const first = await refreshTokenForSession(db, orphaned.token)
      const pair = await exchangeRefreshToken(db, first)
      await db
        .updateTable('refresh_tokens')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('token_id', '=', pair?.refreshToken as string)
        .execute()
      expect(await exchangeRefreshToken(db, first)).toBeNull()
    } finally {
      audit.mockRestore()
    }
  })

  it('revokes the family and ends the session on replay', async () => {
    const session = await createSession()
    const other = await createSession()
    const otherToken = await refreshTokenForSession(db, other.token)
    const initial = await refreshTokenForSession(db, session.token)
    const second = await exchangeRefreshToken(db, initial)
    await exchangeRefreshToken(db, second?.refreshToken as string)
    setSystemTime(new Date(Date.now() + REFRESH_TOKEN_REUSE_INTERVAL_MS + 1000))
    const audit = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await exchangeRefreshToken(db, initial)).toBeNull()
    } finally {
      audit.mockRestore()
    }

    expect(await sessionRow(session.id)).toBeUndefined()
    const family = await db
      .selectFrom('refresh_tokens')
      .select('compromised')
      .where('family_id', '=', (await tokenRow(initial))?.family_id as string)
      .execute()
    expect(family.map((row) => row.compromised)).toEqual([true, true, true])
    expect((await tokenRow(otherToken))?.compromised).toBe(false)
    expect(await sessionRow(other.id)).toBeDefined()
  })

  it('rejects compromised and expired tokens without touching the session', async () => {
    const session = await createSession()
    const initial = await refreshTokenForSession(db, session.token)
    await db
      .updateTable('refresh_tokens')
      .set({ compromised: true })
      .where('token_id', '=', initial)
      .execute()
    expect(await exchangeRefreshToken(db, initial)).toBeNull()

    const fresh = await createSession(userId, 2 * WEEK_MS)
    const token = await refreshTokenForSession(db, fresh.token)
    setSystemTime((await tokenRow(token))?.expires_at as Date)
    expect(await exchangeRefreshToken(db, token)).toBeNull()
    setSystemTime()
    expect((await tokenRow(token))?.consumed).toBe(false)
    expect((await sessionRow(fresh.id))?.token).toBe(fresh.token)
  })

  it('rejects a token whose session expired, without revoking the family', async () => {
    const session = await createSession()
    const initial = await refreshTokenForSession(db, session.token)
    await db
      .updateTable('session')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('id', '=', session.id)
      .execute()

    expect(await exchangeRefreshToken(db, initial)).toBeNull()
    expect((await tokenRow(initial))?.compromised).toBe(false)
    expect((await sessionRow(session.id))?.token).toBe(session.token)
  })

  it('accepts a pre-rotation session token once, returning the session refresh token', async () => {
    const session = await createSession()
    const pair = await exchangeRefreshToken(db, session.token)
    expect(pair?.accessToken).toBe(session.token)
    expect(pair?.refreshToken).toMatch(OPAQUE)
    expect((await tokenRow(pair?.refreshToken as string))?.session_id).toBe(session.id)
    expect(await exchangeRefreshToken(db, session.token)).toBeNull()
  })

  it('accepts the session token of a pre-rotation session with a legacy token row', async () => {
    const session = await createSession()
    // Before #35, sign-in stored a 32-hex token_id that the client never saw.
    const legacy = crypto.randomUUID().replace(/-/g, '')
    await db
      .insertInto('refresh_tokens')
      .values({
        token_id: legacy,
        user_id: userId,
        session_id: session.id,
        family_id: crypto.randomUUID(),
        parent_token_id: null,
        consumed: false,
        compromised: false,
        expires_at: new Date(Date.now() + WEEK_MS),
        created_at: new Date(),
      })
      .execute()

    const pair = await exchangeRefreshToken(db, session.token)
    expect(pair).toEqual({ accessToken: session.token, refreshToken: legacy })
    const rotated = await exchangeRefreshToken(db, legacy)
    expect(rotated?.refreshToken).toMatch(OPAQUE)
    expect(await exchangeRefreshToken(db, rotated?.accessToken as string)).toBeNull()
  })

  it('never exchanges the access token of a session that has an opaque refresh token', async () => {
    const session = await createSession()
    const initial = await refreshTokenForSession(db, session.token)
    expect(await exchangeRefreshToken(db, session.token)).toBeNull()

    const rotated = await exchangeRefreshToken(db, initial)
    expect(await exchangeRefreshToken(db, rotated?.accessToken as string)).toBeNull()
    expect((await tokenRow(initial))?.compromised).toBe(false)
  })

  it('rejects an unknown token', async () => {
    expect(await exchangeRefreshToken(db, 'not-a-token')).toBeNull()
  })
})

describe('revokeSessions', () => {
  async function sessionsWithTokens(owner: string, count: number) {
    const sessions = []
    for (let i = 0; i < count; i++) {
      const session = await createSession(owner)
      sessions.push({ ...session, refresh: await refreshTokenForSession(db, session.token) })
    }
    return sessions
  }

  /** Per session: [session row exists, refresh token row exists]. */
  async function alive(sessions: { id: string; refresh: string }[]) {
    return Promise.all(
      sessions.map(async (s) => [
        Boolean(await sessionRow(s.id)),
        Boolean(await tokenRow(s.refresh)),
      ]),
    )
  }

  it('local revokes only the current session and its refresh tokens', async () => {
    const mine = await sessionsWithTokens(userId, 2)
    const theirs = await sessionsWithTokens(otherUserId, 1)
    expect(await revokeSessions(db, mine[0]?.token as string, 'local')).toBe(true)
    expect(await alive([...mine, ...theirs])).toEqual([
      [false, false],
      [true, true],
      [true, true],
    ])
  })

  it('global revokes every session of the user', async () => {
    const mine = await sessionsWithTokens(userId, 2)
    const theirs = await sessionsWithTokens(otherUserId, 1)
    expect(await revokeSessions(db, mine[0]?.token as string, 'global')).toBe(true)
    expect(await alive([...mine, ...theirs])).toEqual([
      [false, false],
      [false, false],
      [true, true],
    ])
  })

  it('others revokes every session of the user except the current one', async () => {
    const mine = await sessionsWithTokens(userId, 3)
    const theirs = await sessionsWithTokens(otherUserId, 1)
    expect(await revokeSessions(db, mine[1]?.token as string, 'others')).toBe(true)
    expect(await alive([...mine, ...theirs])).toEqual([
      [false, false],
      [true, true],
      [false, false],
      [true, true],
    ])
  })

  it('others with a single session revokes nothing', async () => {
    const mine = await sessionsWithTokens(userId, 1)
    expect(await revokeSessions(db, mine[0]?.token as string, 'others')).toBe(true)
    expect(await alive(mine)).toEqual([[true, true]])
  })

  it('returns false for an unknown or expired access token', async () => {
    expect(await revokeSessions(db, 'unknown', 'global')).toBe(false)
    const expired = await createSession(userId, -1000)
    expect(await revokeSessions(db, expired.token, 'global')).toBe(false)
    expect(await sessionRow(expired.id)).toBeDefined()
  })
})
