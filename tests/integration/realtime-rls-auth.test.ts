/**
 * Realtime postgres_changes delivery for authenticated subscribers under RLS.
 *
 * Reproduces the live Supabase → Sinopebase migration gap: a user subscribes
 * with their session token, then writes through /rest/v1. The event must be
 * delivered when the subscriber can see the row under RLS.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { PostgresDatabase } from '~/core/db-postgres'
import { createClient, type SinopebaseClient } from '~/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

let app: Sinopebase
let baseUrl: string
let client: SinopebaseClient
let userToken = ''
let userId = ''

const anonKey = 'rt-rls-anon-key-min-32-chars!!!!!'
const serviceRoleKey = 'rt-rls-srvc-key-min-32-chars!!!!!'

// ── Helpers (mirror realtime.test.ts) ───────────────────────────────────────

async function rawRealtimeSocket(
  origin: string,
  apiKey: string,
): Promise<{ ws: WebSocket; messages: unknown[]; close: () => void }> {
  const messages: unknown[] = []
  const ws = new WebSocket(
    `${origin.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${apiKey}&vsn=2.0.0`,
  )
  ws.onmessage = (event) => {
    try {
      messages.push(JSON.parse(event.data as string))
    } catch {
      /* ignore malformed frames */
    }
  }
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket connection failed'))
  })
  return { ws, messages, close: () => ws.close() }
}

async function waitForMessage<T>(
  messages: unknown[],
  predicate: (msg: unknown) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const msg = messages.find(predicate)
    if (msg) return msg as T
    await Bun.sleep(20)
  }
  throw new Error('Timed out waiting for WebSocket message')
}

type PhoenixV2Message = [
  joinRef: string | null,
  ref: string | null,
  topic: string,
  event: string,
  payload: Record<string, unknown>,
]

// ── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  const postgresUrl = requirePostgres()

  const db = new PostgresDatabase({ postgresUrl })
  await db.connect()
  await db.getPool().query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    $$;
    GRANT anon, authenticated, service_role TO CURRENT_USER;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    DROP TABLE IF EXISTS rt_rls_messages;
    CREATE TABLE rt_rls_messages (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id uuid NOT NULL,
      body text NOT NULL
    );
    ALTER TABLE rt_rls_messages ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON rt_rls_messages
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    DROP POLICY IF EXISTS rt_rls_messages_select ON rt_rls_messages;
    CREATE POLICY rt_rls_messages_select ON rt_rls_messages FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
    DROP POLICY IF EXISTS rt_rls_messages_insert ON rt_rls_messages;
    CREATE POLICY rt_rls_messages_insert ON rt_rls_messages FOR INSERT
      TO authenticated WITH CHECK (auth.uid() = user_id);
  `)
  await db.close()

  app = new Sinopebase({
    postgresUrl,
    port: portReservation.port,
    jwtSecret: 'rt-rls-test-jwt-secret-min-32-ch!',
    serviceRoleKey,
    anonKey,
  })
  await portReservation.release()
  await app.start()
  baseUrl = portReservation.origin

  client = createClient(baseUrl, anonKey)
  const signUp = await client.auth.signUp({
    email: `rt-rls-${Date.now()}@example.com`,
    password: 'rt-rls-test-password-123',
  })
  expect(signUp.error).toBeNull()
  userToken = signUp.data.session?.access_token ?? ''
  userId = signUp.data.session?.user.id ?? ''
  expect(userToken).not.toBe('')
  expect(userId).not.toBe('')
})

afterAll(async () => {
  await app.stop()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Realtime postgres_changes under RLS', () => {
  it('delivers INSERT to an authenticated subscriber who can see the row', async () => {
    const { ws, messages, close } = await rawRealtimeSocket(baseUrl, anonKey)
    const topic = 'realtime:rt-rls-test'

    try {
      ws.send(
        JSON.stringify([
          '1',
          '1',
          topic,
          'phx_join',
          {
            access_token: userToken,
            config: {
              postgres_changes: [
                { event: 'INSERT', schema: 'public', table: 'rt_rls_messages', filter: null },
              ],
            },
          },
        ]),
      )

      const reply = await waitForMessage<PhoenixV2Message>(messages, (m) => {
        const msg = m as PhoenixV2Message
        return Array.isArray(msg) && msg[2] === topic && msg[3] === 'phx_reply'
      })
      expect(reply[4]).toMatchObject({ status: 'ok' })

      // Write through REST as the same user (RLS allows INSERT).
      const insertResp = await fetch(`${baseUrl}/rest/v1/rt_rls_messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ user_id: userId, body: 'hello realtime' }),
      })
      expect(insertResp.status).toBe(201)

      const insertMsg = await waitForMessage<PhoenixV2Message>(messages, (m) => {
        const msg = m as PhoenixV2Message
        return Array.isArray(msg) && msg[2] === topic && msg[3] === 'postgres_changes'
      })
      expect(insertMsg[4]).toMatchObject({
        data: {
          type: 'INSERT',
          schema: 'public',
          table: 'rt_rls_messages',
          record: expect.objectContaining({ body: 'hello realtime' }),
        },
      })
    } finally {
      close()
    }
  })

  it('delivers INSERT through the SDK realtime channel (supabase-js parity)', async () => {
    let received: unknown = null
    const channel = client.realtime.channel('realtime:rt-rls-sdk')
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'rt_rls_messages' },
      (payload) => {
        received = payload
      },
    )
    await channel.subscribe((status) => {
      expect(status).toBe('SUBSCRIBED')
    })
    // Give the server a beat to bind the channel before the write lands.
    await Bun.sleep(100)

    const insertResp = await fetch(`${baseUrl}/rest/v1/rt_rls_messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ user_id: userId, body: 'hello via sdk' }),
    })
    expect(insertResp.status).toBe(201)

    const deadline = Date.now() + 5000
    while (!received && Date.now() < deadline) await Bun.sleep(20)
    expect(received).not.toBeNull()
    expect((received as { data: Record<string, unknown> }).data).toMatchObject({
      type: 'INSERT',
      schema: 'public',
      table: 'rt_rls_messages',
      record: expect.objectContaining({ body: 'hello via sdk' }),
    })

    channel.unsubscribe()
  })
})
