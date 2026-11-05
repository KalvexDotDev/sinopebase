/**
 * The release binary must serve Better Auth's POST endpoints (sinope#1144).
 *
 * Staging runs the `bun build --compile` executable, not the source. There the
 * OAuth client registration answered 500 with "Body already used": Elysia read
 * the request body before handing the request to Better Auth. These tests build
 * the binary with the image's flags (the `compile:release` script), run it as a
 * separate process over HTTP, and drive a real agent grant: registration,
 * sign-in, consent, the code and refresh token exchanges and revocation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { hashPassword } from 'better-auth/crypto'
import pg from 'pg'
import packageJson from '../../package.json'
import { installAgentGrantFixture, reserveLoopbackPort } from '../harness'

const postgresUrl = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

const projectRoot = resolve(import.meta.dir, '../..')
const resource = 'http://127.0.0.1:5173/mcp'
const consentUrl = 'http://127.0.0.1:5173/oauth/consent'
const redirectUri = 'http://127.0.0.1:33418/callback'
const tenant = 'b0981144-0000-4000-8000-00000000000a'
const password = 'compiled server 1144 password'
const clientName = 'Agent 1144 compiled'

interface Tokens {
  access_token: string
  refresh_token: string
}

describePostgres('release binary: Better Auth POST endpoints (sinope#1144)', () => {
  let pool: pg.Pool
  let workDir = ''
  let origin = ''
  let server: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
  let serverOutput = Promise.resolve('')
  const userId = randomUUID()
  const email = `compiled-1144-${userId}@example.test`

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const postForm = (path: string, body: Record<string, string>) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })

  /** Build with the Dockerfile's `compile:release` flags, using the Bun running this test. */
  async function compile(outfile: string) {
    const [command, ...args] = packageJson.scripts['compile:release'].split(' ')
    expect(command).toBe('bun')
    const build = Bun.spawn([process.execPath, ...args, '--outfile', outfile], {
      cwd: projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [output, errors, code] = await Promise.all([
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
      build.exited,
    ])
    if (code !== 0) throw new Error(`compile:release failed:\n${output}${errors}`)
  }

  async function waitUntilReady() {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (server?.exitCode !== null) {
        throw new Error(`release binary exited:\n${await serverOutput}`)
      }
      const healthy = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })
        .then((response) => response.ok)
        .catch(() => false)
      if (healthy) return
      // Polls a separate OS process; there is no in-process readiness signal to await.
      await Bun.sleep(50)
    }
    throw new Error('release binary did not become ready')
  }

  beforeAll(async () => {
    if (!postgresUrl) throw new Error('TEST_POSTGRES_URL required')
    workDir = await mkdtemp(resolve(tmpdir(), 'sinopebase-1144-'))
    const binary = resolve(workDir, 'sinopebase')
    await compile(binary)

    const reservation = await reserveLoopbackPort()
    origin = reservation.origin
    await reservation.release()
    // The staging configuration: production mode with public signup closed.
    server = Bun.spawn([binary], {
      cwd: projectRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOST: reservation.host,
        PORT: String(reservation.port),
        DATA_DIR: resolve(workDir, 'data'),
        POSTGRES_URL: postgresUrl,
        JWT_SECRET: randomBytes(32).toString('hex'),
        SINOPEBASE_SERVICE_ROLE_KEY: randomBytes(32).toString('hex'),
        SINOPEBASE_ANON_KEY: randomBytes(32).toString('hex'),
        SINOPEBASE_PRODUCTION: 'true',
        ALLOW_SIGNUPS: 'false',
        BETTER_AUTH_URL: origin,
        RUSTFS_ENDPOINT: process.env.RUSTFS_ENDPOINT ?? 'http://127.0.0.1:9',
        RUSTFS_ACCESS_KEY: process.env.RUSTFS_ACCESS_KEY ?? 'unused',
        RUSTFS_SECRET_KEY: process.env.RUSTFS_SECRET_KEY ?? 'unused',
        SINOPEBASE_SITE_URL: 'http://127.0.0.1:5173',
        SINOPEBASE_AGENT_GRANT_RESOURCE: resource,
        SINOPEBASE_AGENT_GRANT_CONSENT_URL: consentUrl,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    serverOutput = Promise.all([
      new Response(server.stdout).text(),
      new Response(server.stderr).text(),
    ]).then((streams) => streams.join(''))
    await waitUntilReady()

    pool = new pg.Pool({ connectionString: postgresUrl, max: 2 })
    await installAgentGrantFixture(pool)
    await pool.query(
      `INSERT INTO "user" ("id", "email", "emailVerified", "name", "role", "createdAt", "updatedAt")
       VALUES ($1, $2, true, 'Compiled 1144', 'user', now(), now())`,
      [userId, email],
    )
    await pool.query(
      `INSERT INTO "account" ("id", "userId", "providerId", "accountId", "password", "createdAt", "updatedAt")
       VALUES ($1, $1, 'credential', $1, $2, now(), now())`,
      [userId, await hashPassword(password)],
    )
    await pool.query(`INSERT INTO agent_grant_test_memberships VALUES ($1, $2)`, [userId, tenant])
  }, 120_000)

  afterAll(async () => {
    if (server?.exitCode === null) server.kill('SIGTERM')
    await server?.exited
    if (pool) {
      await pool.query(`DELETE FROM "oauthClient" WHERE "name" = $1`, [clientName])
      await pool.query(`DELETE FROM agent_grant_test_memberships WHERE user_id = $1`, [userId])
      await pool.query(`DELETE FROM "user" WHERE "id" = $1`, [userId])
      await pool.end()
    }
    if (workDir) await rm(workDir, { recursive: true, force: true })
  })

  it('registers, signs in, consents, exchanges, refreshes and revokes over HTTP', async () => {
    // RFC 7591 dynamic client registration: JSON body read by Better Auth.
    const registration = await post('/api/auth/oauth2/register', {
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    expect(registration.status).toBe(201)
    const clientId = ((await registration.json()) as { client_id: string }).client_id

    // Native email sign-in through the /api/auth/* pass-through.
    const signIn = await post('/api/auth/sign-in/email', { email, password }, { origin })
    expect(signIn.status).toBe(200)
    const session = ((await signIn.json()) as { token: string }).token

    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'offline_access',
      state: 'state-1144',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
    const authorize = await fetch(`${origin}/api/auth/oauth2/authorize?${query}`, {
      redirect: 'manual',
    })
    const consentPage = new URL(authorize.headers.get('location') ?? '')
    expect(`${consentPage.origin}${consentPage.pathname}`).toBe(consentUrl)

    const consent = await post(
      '/auth/v1/agent-grants',
      { oauth_query: consentPage.search.slice(1), tenant_id: tenant },
      { authorization: `Bearer ${session}` },
    )
    expect(consent.status).toBe(200)
    const redirect = new URL(((await consent.json()) as { redirect_to: string }).redirect_to)

    // The token endpoint takes a form-encoded body.
    const exchange = await postForm('/api/auth/oauth2/token', {
      client_id: clientId,
      grant_type: 'authorization_code',
      code: redirect.searchParams.get('code') ?? '',
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })
    expect(exchange.status).toBe(200)
    const issued = (await exchange.json()) as Tokens

    const refresh = await postForm('/api/auth/oauth2/token', {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
    })
    expect(refresh.status).toBe(200)
    const refreshed = (await refresh.json()) as Tokens

    const revoke = await postForm('/api/auth/oauth2/revoke', {
      client_id: clientId,
      token: refreshed.refresh_token,
      token_type_hint: 'refresh_token',
    })
    expect(revoke.status).toBe(200)
    const reuse = await postForm('/api/auth/oauth2/token', {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshed.refresh_token,
    })
    expect(reuse.status).toBe(400)
  })

  it('answers a malformed registration with a client error, never a 500', async () => {
    const response = await post('/api/auth/oauth2/register', { client_name: clientName })
    expect(response.status).toBe(400)
  })
})
