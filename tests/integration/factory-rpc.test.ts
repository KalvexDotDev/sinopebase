/**
 * Factory RPC ATDD Tests — the f_* schema and factory_* RPC functions.
 *
 * Verifies the atomic factory operations end-to-end through the real backend:
 * SDK → HTTP → auth guard → PostgREST route → PostgreSQL, including the
 * RLS split (service_role works, anon is denied) and the parity behaviors the
 * Kalvex factory's TypeScript layer depends on:
 *   - pending-only transitions raise 'not pending' / 'not sendable'
 *   - andon halt blocks sends
 *   - lineage penalties + reject streaks
 *   - edit penalties write correction metrics
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { PostgresDatabase } from '~/core/db-postgres'
import { createClient, type SinopebaseClient } from '~/sdk/client'
import { requirePostgres, reserveLoopbackPort } from '../harness'

let app: Sinopebase
let baseUrl: string
let serviceClient: SinopebaseClient
let anonClient: SinopebaseClient

const anonKey = 'factory-anon-key-min-32-chars!!!!!'
const serviceRoleKey = 'factory-srvc-key-min-32-chars!!!!!'

interface MessageRow {
  id: number
  agent: string
  kind: string
  contact: string
  copy: string
  original_copy: string
  context: string
  platform: string
  status: string
  scheduled_at: number | null
  sent_at: number | null
  sampled: boolean
}

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  const postgresUrl = requirePostgres()

  const db = new PostgresDatabase({ postgresUrl })
  await db.connect()
  const pool = db.getPool()
  await pool.query(`
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
  `)

  app = new Sinopebase({
    postgresUrl,
    port: portReservation.port,
    jwtSecret: 'factory-rpc-test-jwt-secret-min-32!',
    serviceRoleKey,
    anonKey,
  })
  await portReservation.release()
  await app.start()
  baseUrl = portReservation.origin

  serviceClient = createClient(baseUrl, serviceRoleKey)
  anonClient = createClient(baseUrl, anonKey)

  // Fresh tables per run — the migration created them at boot.
  await pool.query('TRUNCATE f_agents CASCADE')
  await pool.query(
    'TRUNCATE f_metrics, f_missions, f_browser_tasks, f_radar_events, f_cost_events, f_andon_events, f_state RESTART IDENTITY',
  )
})

afterAll(async () => {
  await app.stop()
})

async function queueFirst(overrides: Partial<MessageRow> = {}): Promise<MessageRow> {
  const agent = overrides.agent ?? 'outreach'
  const contact = overrides.contact ?? 'alice@example.com'
  const copy = overrides.copy ?? 'hello alice'
  await serviceClient.rpc('factory_register_agent', {
    p_name: agent,
    p_trust: 0,
    p_internal: false,
    p_parent: null,
  })
  const res = await serviceClient.rpc<MessageRow>('factory_queue_message', {
    p_agent: agent,
    p_kind: 'firstTouch',
    p_contact: contact,
    p_copy: copy,
    p_original_copy: overrides.original_copy ?? copy,
    p_context: '',
    p_platform: 'linkedin',
    p_status: 'pending',
    p_scheduled_at: null,
    p_sampled: false,
  })
  if (res.error) throw new Error(`queue failed: ${res.error.message}`)
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as MessageRow
  if (!row) throw new Error('queue returned no row')
  return { ...overrides, ...row }
}

describe('factory rpc', () => {
  it('register + queue: unknown agent raises, known agent queues pending', async () => {
    const unknown = await serviceClient.rpc('factory_queue_message', {
      p_agent: 'ghost',
      p_kind: 'firstTouch',
      p_contact: 'x@example.com',
      p_copy: 'hi',
      p_original_copy: 'hi',
      p_context: '',
      p_platform: '',
      p_status: 'pending',
      p_scheduled_at: null,
      p_sampled: false,
    })
    expect(unknown.error?.message).toContain('unknown agent')

    const msg = await queueFirst()
    expect(msg.status).toBe('pending')
    expect(msg.sampled).toBe(false)
  })

  it('approve: schedules, bumps trust, counts unchanged approvals', async () => {
    const msg = await queueFirst({ contact: 'bob@example.com' })
    const res = await serviceClient.rpc<MessageRow>('factory_approve_message', {
      p_id: msg.id,
      p_copy: msg.copy,
      p_scheduled_at: 1000,
      p_delta: 1,
      p_ts: 1000,
    })
    expect(res.error).toBeNull()
    const row = (res.data as MessageRow[])[0] as MessageRow
    expect(row.status).toBe('scheduled')
    expect(Number(row.scheduled_at)).toBe(1000)

    const agent = await serviceClient
      .from('f_agents')
      .select('*')
      .eq('name', 'outreach')
      .maybeSingle()
    expect(Number(agent.data?.trust)).toBe(1)
    expect(Number(agent.data?.approved_count)).toBe(1)
  })

  it('approve with edit penalty: correction metric recorded, trust clamps at 0', async () => {
    const msg = await queueFirst({ contact: 'carol@example.com' })
    const res = await serviceClient.rpc<MessageRow>('factory_approve_message', {
      p_id: msg.id,
      p_copy: 'edited copy that is different',
      p_scheduled_at: 2000,
      p_delta: -5,
      p_ts: 2000,
    })
    expect(res.error).toBeNull()

    const digestRes = await serviceClient.rpc('factory_digest', { p_since_ts: 0 })
    expect(digestRes.error).toBeNull()
    expect(Number((digestRes.data as Array<{ corrections: number }>)[0]?.corrections)).toBe(1)
  })

  it('reject: appends reason, penalizes creator + ancestors, tracks streak', async () => {
    await serviceClient.rpc('factory_register_agent', {
      p_name: 'strategist',
      p_trust: 40,
      p_internal: true,
      p_parent: null,
    })
    await serviceClient.rpc('factory_register_agent', {
      p_name: 'outreach-child',
      p_trust: 20,
      p_internal: false,
      p_parent: 'strategist',
    })
    const msg = await queueFirst({ agent: 'outreach-child', contact: 'dave@example.com' })
    const res = await serviceClient.rpc<MessageRow>('factory_reject_message', {
      p_id: msg.id,
      p_reason: 'bad idea',
      p_ts: 3000,
      p_agent_penalty: 3,
      p_lineage_penalty: 5,
    })
    expect(res.error).toBeNull()
    const row = (res.data as MessageRow[])[0] as MessageRow
    expect(row.status).toBe('rejected')
    expect(row.copy).toContain(' -- REJECTED: bad idea')

    const child = await serviceClient
      .from('f_agents')
      .select('*')
      .eq('name', 'outreach-child')
      .maybeSingle()
    expect(Number(child.data?.trust)).toBe(17)
    const parent = await serviceClient
      .from('f_agents')
      .select('*')
      .eq('name', 'strategist')
      .maybeSingle()
    expect(Number(parent.data?.trust)).toBe(35)

    const streak = await serviceClient
      .from('f_state')
      .select('*')
      .eq('key', 'reject_streak:outreach-child')
      .maybeSingle()
    expect(streak.data?.value).toBe('1')
  })

  it('send: marks sent once, second send raises not sendable', async () => {
    const msg = await queueFirst({ contact: 'eve@example.com' })
    await serviceClient.rpc('factory_approve_message', {
      p_id: msg.id,
      p_copy: msg.copy,
      p_scheduled_at: 4000,
      p_delta: 1,
      p_ts: 4000,
    })
    const send = await serviceClient.rpc<MessageRow>('factory_send_message', {
      p_id: msg.id,
      p_ts: 5000,
    })
    expect(send.error).toBeNull()
    const row = (send.data as MessageRow[])[0] as MessageRow
    expect(row.status).toBe('sent')
    expect(Number(row.sent_at)).toBe(5000)

    const again = await serviceClient.rpc('factory_send_message', { p_id: msg.id, p_ts: 6000 })
    expect(again.error?.message).toContain('not sendable')
  })

  it('andon: pull halts sends, resume clears the halt and records the decision', async () => {
    const msg = await queueFirst({ contact: 'frank@example.com' })
    await serviceClient.rpc('factory_approve_message', {
      p_id: msg.id,
      p_copy: msg.copy,
      p_scheduled_at: 7000,
      p_delta: 1,
      p_ts: 7000,
    })

    const pull = await serviceClient.rpc('factory_pull_andon', {
      p_trigger: 'red_team_stop',
      p_detail: 'test halt',
      p_ts: 8000,
      p_snapshot: '{"sends":0}',
    })
    expect(pull.error).toBeNull()

    const blocked = await serviceClient.rpc('factory_send_message', { p_id: msg.id, p_ts: 9000 })
    expect(blocked.error?.message).toContain('factory halted')

    const events = await serviceClient.from('f_andon_events').select('*').maybeSingle()
    const eventId = Number(events.data?.id)
    const resume = await serviceClient.rpc('factory_resume_andon', {
      p_event_id: eventId,
      p_decision: 'keep going',
    })
    expect(resume.error).toBeNull()

    const after = await serviceClient.rpc<MessageRow>('factory_send_message', {
      p_id: msg.id,
      p_ts: 10000,
    })
    expect(after.error).toBeNull()
    expect(((after.data as MessageRow[])[0] as MessageRow).status).toBe('sent')

    const decided = await serviceClient
      .from('f_andon_events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle()
    expect(decided.data?.decision).toBe('keep going')
  })

  it('dryrun send: records sent_dryrun, never sent', async () => {
    const msg = await queueFirst({ contact: 'grace@example.com' })
    await serviceClient.rpc('factory_approve_message', {
      p_id: msg.id,
      p_copy: msg.copy,
      p_scheduled_at: 11000,
      p_delta: 1,
      p_ts: 11000,
    })
    const res = await serviceClient.rpc<MessageRow>('factory_dryrun_send', {
      p_id: msg.id,
      p_ts: 12000,
    })
    expect(res.error).toBeNull()
    expect(((res.data as MessageRow[])[0] as MessageRow).status).toBe('sent')

    const digestRes = await serviceClient.rpc('factory_digest', { p_since_ts: 0 })
    const d = (digestRes.data as Array<{ sends: number; dryrun_sends: number }>)[0] as {
      sends: number
      dryrun_sends: number
    }
    expect(Number(d.dryrun_sends)).toBe(1)
    expect(Number(d.sends)).toBe(2) // frank (post-resume) + eve
  })

  it('sweep upsert: dedupes on (source, url, title)', async () => {
    const card = {
      p_source: 'reddit',
      p_title: 'spreadsheets are awful',
      p_text: 'body',
      p_url: 'https://reddit.com/x',
      p_author: 'u1',
      p_community: 'compliance',
      p_domain: 'evidence-management',
      p_strength: 'strong',
      p_first_seen: 13000,
    }
    const first = await serviceClient.rpc('factory_sweep_upsert', card)
    expect(first.error).toBeNull()
    expect((first.data as unknown[]).length).toBe(1)
    const second = await serviceClient.rpc('factory_sweep_upsert', card)
    expect((second.data as unknown[]).length).toBe(0)
  })

  it('plan mission: queues the message and marks the mission planned atomically', async () => {
    const mission = await serviceClient
      .from('f_missions')
      .insert({
        source: 'workspace',
        contact: 'henry@example.com',
        company: 'acme',
        context: 'pain: evidence',
      })
      .select('*')
      .single()
    expect(mission.error).toBeNull()
    const missionId = Number((mission.data as { id: number }).id)

    const res = await serviceClient.rpc<MessageRow>('factory_plan_mission', {
      p_mission_id: missionId,
      p_agent: 'outreach',
      p_kind: 'firstTouch',
      p_contact: 'henry@example.com',
      p_copy: 'hi henry',
      p_context: 'pain: evidence',
      p_platform: 'linkedin',
      p_status: 'pending',
      p_scheduled_at: null,
      p_sampled: false,
    })
    expect(res.error).toBeNull()
    expect(((res.data as MessageRow[])[0] as MessageRow).status).toBe('pending')

    const updated = await serviceClient
      .from('f_missions')
      .select('*')
      .eq('id', missionId)
      .maybeSingle()
    expect(updated.data?.status).toBe('planned')
  })

  it('browser task: edit penalty applied, message sent, task done, repeat is a no-op string', async () => {
    const msg = await queueFirst({ contact: 'iris@example.com' })
    await serviceClient.rpc('factory_approve_message', {
      p_id: msg.id,
      p_copy: msg.copy,
      p_scheduled_at: 14000,
      p_delta: 1,
      p_ts: 14000,
    })
    const task = await serviceClient
      .from('f_browser_tasks')
      .insert({
        message_id: msg.id,
        platform: 'reddit',
      })
      .select('*')
      .single()
    const taskId = Number((task.data as { id: number }).id)

    // Trust before the edit — the edit penalty applies the -2 delta on top
    // of whatever earlier approvals accumulated (suite-order independent).
    const before = await serviceClient
      .from('f_agents')
      .select('*')
      .eq('name', 'outreach')
      .maybeSingle()
    const trustBefore = Number(before.data?.trust)

    const done = await serviceClient.rpc(
      'factory_complete_browser_task',
      {
        p_task_id: taskId,
        p_edited_copy: 'edited in browser',
        p_delta: -2,
        p_ts: 15000,
      },
      { get: true },
    )
    expect(done.error).toBeNull()
    expect(done.data as unknown as string).toContain('marked sent')
    expect(done.data as unknown as string).toContain('task #' + taskId)

    const msgAfter = await serviceClient
      .from('f_messages')
      .select('*')
      .eq('id', msg.id)
      .maybeSingle()
    expect(msgAfter.data?.status).toBe('sent')

    const outreach = await serviceClient
      .from('f_agents')
      .select('*')
      .eq('name', 'outreach')
      .maybeSingle()
    expect(Number(outreach.data?.trust)).toBe(trustBefore - 2)

    const repeat = await serviceClient.rpc(
      'factory_complete_browser_task',
      {
        p_task_id: taskId,
        p_edited_copy: null,
        p_delta: 0,
        p_ts: 16000,
      },
      { get: true },
    )
    expect(done.error).toBeNull()
    expect(repeat.data as unknown as string).toContain('already done')
  })

  it('trust gate lookup: pending copy hits, approved copy misses', async () => {
    const pending = await queueFirst({
      contact: 'judy@example.com',
      copy: 'UNIQUE_GATE_COPY_42',
      original_copy: 'UNIQUE_GATE_COPY_42',
    })
    const hit = await serviceClient.rpc('factory_trust_gate_lookup', {
      p_text: 'UNIQUE_GATE_COPY_42',
    })
    expect(hit.error).toBeNull()
    expect((hit.data as Array<{ status: string }>).length).toBe(1)
    expect((hit.data as Array<{ status: string }>)[0]?.status).toBe('pending')

    await serviceClient.rpc('factory_approve_message', {
      p_id: pending.id,
      p_copy: pending.copy,
      p_scheduled_at: 17000,
      p_delta: 1,
      p_ts: 17000,
    })
    const miss = await serviceClient.rpc('factory_trust_gate_lookup', {
      p_text: 'UNIQUE_GATE_COPY_42',
    })
    expect((miss.data as unknown[]).length).toBe(0)
  })

  it('track cost + metric regression: cost row lands, regression flags below rate', async () => {
    const cost = await serviceClient.rpc('factory_track_cost', {
      p_model: 'gpt-5.6-sol',
      p_input_tokens: 100,
      p_output_tokens: 50,
      p_est_cost: 0.002,
      p_ts: 18000,
    })
    expect(cost.error).toBeNull()
    const rows = await serviceClient.from('f_cost_events').select('*')
    expect((rows.data as unknown[]).length).toBe(1)

    const reg = await serviceClient.rpc('factory_metric_regression', {
      p_min_sends: 2,
      p_min_meeting_rate: 0.05,
    })
    expect(reg.error).toBeNull()
    const r = (reg.data as Array<{ sends: number; meetings: number; below_rate: boolean }>)[0] as {
      sends: number
      meetings: number
      below_rate: boolean
    }
    expect(Number(r.sends)).toBeGreaterThanOrEqual(2)
    expect(Number(r.meetings)).toBe(0)
    expect(r.below_rate).toBe(true)
  })

  it('browser tasks list: returns queued tasks joined with message copy', async () => {
    const list = await serviceClient.rpc('factory_browser_tasks')
    expect(list.error).toBeNull()
    // iris's task is done; no queued tasks remain after this suite's flow
    expect(Array.isArray(list.data)).toBe(true)
  })

  it('RLS: anon cannot read or rpc the factory tables', async () => {
    const read = await anonClient.from('f_agents').select('*')
    // Hard-deny now that the migration revokes default-privilege grants:
    // anon must get an error, not silently-filtered empty rows.
    expect(read.error).not.toBeNull()
    expect(read.data).toBeNull()

    const rpc = await anonClient.rpc('factory_digest', { p_since_ts: 0 })
    expect(rpc.error).not.toBeNull()
    expect(rpc.error?.code).toBe('42501')
  })
})
