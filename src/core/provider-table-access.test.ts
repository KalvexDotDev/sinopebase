import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'
import { startLoopbackApp } from '../../tests/harness/server'
import { createClient } from '../sdk/client'
import { createAuth } from '../tools/auth-better'
import { Sinopebase } from './app'

const postgresUrl = process.env.TEST_POSTGRES_URL
const postgres = postgresUrl ? describe : describe.skip
postgres('provider table API boundary', () => {
  let app: Sinopebase
  let origin: string
  const anonKey = crypto.randomUUID()
  const serviceRoleKey = crypto.randomUUID()
  const jwtSecret = crypto.randomUUID() + crypto.randomUUID()
  const pool = new pg.Pool({ connectionString: postgresUrl })
  const config = { postgresUrl, anonKey, serviceRoleKey, jwtSecret }
  const email = `provider-acl-${crypto.randomUUID()}@example.test`
  const password = 'synthetic-provider-password-123!'
  let token: string
  beforeAll(async () => {
    const started = await startLoopbackApp(config)
    app = started.app
    origin = started.origin
  })
  afterAll(async () => {
    await app?.stop()
    await pool.end()
  })
  it('denies anonymous direct reads of provider identity and credential tables', async () => {
    for (const table of ['user', 'session', 'account', 'verification', 'refresh_tokens']) {
      const response = await fetch(`${origin}/rest/v1/${table}?select=*&limit=0`, {
        headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
      })
      expect(response.status).toBe(401)
    }
  })
  it('preserves signup, password login, user lookup and refresh while denying member reads/writes', async () => {
    const client = createClient(origin, anonKey)
    const signup = await client.auth.signUp({ email, password })
    expect(signup.error).toBeNull()
    expect(Boolean(signup.data.session)).toBe(true)
    const login = await client.auth.signInWithPassword({ email, password })
    expect(login.error).toBeNull()
    expect((await client.auth.getUser()).data.user?.email).toBe(email)
    const refresh = await client.auth.refreshSession()
    expect(refresh.error).toBeNull()
    token = refresh.data.session?.access_token ?? ''
    expect(Boolean(token)).toBe(true)
    for (const table of ['user', 'session', 'account', 'verification', 'refresh_tokens']) {
      const headers = {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      }
      const read = await fetch(`${origin}/rest/v1/${table}?select=*&limit=0`, { headers })
      expect(read.status).toBe(403)
      const key = table === 'refresh_tokens' ? 'token_id' : 'id'
      const insert = await fetch(`${origin}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ [key]: 'synthetic-marker' }),
      })
      expect(insert.status).toBe(403)
      for (const method of ['PATCH', 'DELETE']) {
        const write = await fetch(
          `${origin}/rest/v1/${table}?${key}=eq.nonexistent-synthetic-row`,
          {
            method,
            headers,
            ...(method === 'PATCH' ? { body: JSON.stringify({ [key]: 'synthetic-marker' }) } : {}),
          },
        )
        expect(write.status).toBe(403)
      }
    }
  })
  it('repairs stale table and column grants on restart without replaying migrations', async () => {
    await app.stop()
    await pool.query(
      'GRANT SELECT ON public.session TO anon; GRANT SELECT (password), UPDATE (password) ON public.account TO authenticated; GRANT SELECT (value) ON public.verification TO PUBLIC',
    )
    const started = await startLoopbackApp(config)
    app = started.app
    origin = started.origin
    for (const bearer of [anonKey, token]) {
      for (const [table, column] of [
        ['session', 'token'],
        ['account', 'password'],
        ['verification', 'value'],
      ]) {
        const result = await fetch(`${origin}/rest/v1/${table}?select=${column}&limit=0`, {
          headers: { apikey: anonKey, authorization: `Bearer ${bearer}` },
        })
        expect(result.status).toBe(bearer === anonKey ? 401 : 403)
      }
    }
    const client = createClient(origin, anonKey)
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull()
  })

  it('refuses startup before listening when inherited provider privileges cannot be removed', async () => {
    await app.stop()
    const inheritedRole = `provider_acl_${crypto.randomUUID().replaceAll('-', '')}`
    await pool.query(
      `CREATE ROLE ${inheritedRole} NOLOGIN; GRANT SELECT ON public.session TO ${inheritedRole}; GRANT ${inheritedRole} TO anon`,
    )
    const refused = new Sinopebase({ ...config, host: '127.0.0.1', port: 0 })
    let listening = false
    refused.use(async (router) => {
      router.onStart(() => {
        listening = true
      })
    })
    try {
      await expect(refused.start()).rejects.toThrow(
        'PostgreSQL authentication initialization failed',
      )
      expect(listening).toBe(false)
    } finally {
      await refused.stop()
      await pool.query(
        `REVOKE ${inheritedRole} FROM anon; REVOKE SELECT ON public.session FROM ${inheritedRole}; DROP ROLE ${inheritedRole}`,
      )
    }
  })

  it('creates and hardens the provider tables from replicas starting together on a new database', async () => {
    for (let round = 0; round < 3; round++) {
      const database = `provider_acl_${crypto.randomUUID().replaceAll('-', '')}`
      await pool.query(`CREATE DATABASE "${database}"`)
      const url = new URL(postgresUrl as string)
      url.pathname = `/${database}`
      // Separate pools stand in for replicas: each creates the schema and repairs grants at once.
      const replicas = Array.from({ length: 4 }, () => new pg.Pool({ connectionString: url.href }))
      try {
        const started = await Promise.allSettled(replicas.map((replica) => createAuth(replica)))
        expect(started.filter((result) => result.status === 'rejected')).toEqual([])
      } finally {
        await Promise.all(replicas.map((replica) => replica.end()))
        await pool.query(`DROP DATABASE "${database}" WITH (FORCE)`)
      }
    }
  })
})
