/**
 * Dual-Mode Auth Contract — identical behavior with and without PostgreSQL
 *
 * Closes the codex audit's [P1] gap for feature 5: auth behaves the same
 * whether better-auth (PostgreSQL) or the in-memory jose fallback backs the
 * /auth/v1/* endpoints. The same SDK-driven contract runs against both:
 *
 *   - signUp                       → session token truthy
 *   - signInWithPassword (wrong)   → error
 *   - signInWithPassword (right)   → session
 *   - getUser()                    → the signed-in user
 *   - signOut()                    → subsequent getUser() fails
 *
 * Postgres mode: postgresUrl set  → better-auth + PG (createAuthPlugin).
 * Memory mode:   postgresUrl ''   → in-memory DB + jose auth (authPlugin).
 *
 * Documented divergences (parity asserted only where the contract matches):
 *   - Error message strings differ ("Invalid email or password" vs "Invalid
 *     login credentials") — tests assert status + error presence, not text.
 *   - Session token format differs (better-auth opaque token vs jose JWT) —
 *     tests assert truthiness, not shape.
 *   - Memory mode does not persist across restarts (by design, dev-only).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sinopebase } from '../../src/core/app'
import { createClient, type SinopebaseClient } from '../../src/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'
import { uniqueEmail } from './setup'

const JWT_SECRET = 'dualmode-jwt-secret-min-32-chars!!!'
const SERVICE_ROLE_KEY = 'dualmode-service-role-key-min-32'
const ANON_KEY = 'dualmode-anon-key-min-32-chars!!!!'

interface ModeServer {
  label: 'postgres' | 'memory'
  server: Sinopebase
  baseUrl: string
  client: SinopebaseClient
  dataDir: string
}

async function startServer(label: ModeServer['label'], postgresUrl: string): Promise<ModeServer> {
  const portReservation = await reserveLoopbackPort()
  const dataDir = mkdtempSync(join(tmpdir(), `sinopebase-auth-${label}-`))
  const server = new Sinopebase({
    port: portReservation.port,
    postgresUrl,
    jwtSecret: JWT_SECRET,
    serviceRoleKey: SERVICE_ROLE_KEY,
    anonKey: ANON_KEY,
    dataDir,
  })
  await portReservation.release()
  await server.start()
  const baseUrl = portReservation.origin
  return { label, server, baseUrl, client: createClient(baseUrl, ANON_KEY), dataDir }
}

describe('auth dual-mode contract', () => {
  let postgresMode: ModeServer
  let memoryMode: ModeServer

  beforeAll(async () => {
    // Empty-string postgresUrl forces the in-memory fallback even when
    // POSTGRES_URL happens to be set in the environment.
    postgresMode = await startServer('postgres', requirePostgres())
    memoryMode = await startServer('memory', '')
  })

  afterAll(async () => {
    for (const mode of [postgresMode, memoryMode]) {
      await mode.server.stop()
      rmSync(mode.dataDir, { recursive: true, force: true })
    }
  })

  /**
   * The shared auth behavior contract. Same test names in both modes so the
   * parity is visible in the runner output. Divergences are noted inline.
   *
   * The server is resolved through a getter because describe bodies evaluate
   * before beforeAll assigns the mode variables; tests run after.
   */
  function runAuthContract(label: ModeServer['label'], getMode: () => ModeServer): void {
    const email = uniqueEmail()
    const password = 'dual-mode-password-123!'

    describe(`${label} mode — SDK auth contract`, () => {
      test('signUp returns a session with a truthy access token', async () => {
        const { client } = getMode()
        const { data, error } = await client.auth.signUp({ email, password })
        expect(error).toBeNull()
        expect(data.session).not.toBeNull()
        // Token format diverges (better-auth opaque token vs jose JWT) —
        // parity is truthiness, not shape.
        expect(typeof data.session?.access_token).toBe('string')
        expect(data.session?.access_token?.length ?? 0).toBeGreaterThan(0)
        expect(data.session?.user.email).toBe(email)
      })

      test('signInWithPassword rejects a wrong password', async () => {
        const { client } = getMode()
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password: 'wrong-password-999',
        })
        expect(data.session).toBeNull()
        expect(data.user).toBeNull()
        expect(error).not.toBeNull()
        expect(error?.status).toBe(400)
        // Divergence: better-auth says "Invalid email or password"; the jose
        // fallback says "Invalid login credentials". Parity is the status.
        expect(error?.message?.length ?? 0).toBeGreaterThan(0)
      })

      test('signInWithPassword accepts the correct password', async () => {
        const { client } = getMode()
        const { data, error } = await client.auth.signInWithPassword({ email, password })
        expect(error).toBeNull()
        expect(data.session).not.toBeNull()
        expect(data.session?.access_token).toBeTruthy()
        expect(data.session?.user.email).toBe(email)
      })

      test('getUser returns the signed-in user', async () => {
        const { client } = getMode()
        const { data, error } = await client.auth.getUser()
        expect(error).toBeNull()
        expect(data.user).not.toBeNull()
        expect(data.user?.email).toBe(email)
      })

      test('signOut invalidates the session — subsequent getUser fails', async () => {
        const { client } = getMode()
        const { error } = await client.auth.signOut()
        expect(error).toBeNull()

        const { data, error: getUserError } = await client.auth.getUser()
        expect(getUserError).not.toBeNull()
        expect(data.user).toBeNull()
      })
    })
  }

  runAuthContract('postgres', () => postgresMode)
  runAuthContract('memory', () => memoryMode)
})
