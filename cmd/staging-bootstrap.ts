/** Private, one-time Sinope staging bootstrap. Never mount this command in the public server. */
import { readFile } from 'node:fs/promises'
import { Pool, type PoolClient } from 'pg'
import { z } from 'zod'
import { createAuth } from '../src/tools/auth-better'

const stagingHost = 'pg-sinope-staging.postgres.database.azure.com'
const inputSchema = z.object({
  databaseUrl: z.url(),
  azureResourceId: z
    .string()
    .regex(
      /^\/subscriptions\/[^/]+\/resourcegroups\/rg-sinope-staging\/providers\/microsoft\.dbforpostgresql\/flexibleservers\/pg-sinope-staging$/i,
    ),
  email: z.email().transform((value) => value.toLowerCase()),
  tenantName: z.string().trim().min(1).max(200),
  passwordFile: z.string().min(1).optional(),
})

type Input = z.infer<typeof inputSchema>
type Existing = {
  id: string
  email: string
  role: string
  mirror_email: string | null
  credential_count: string
}
type Membership = { tenant_id: string; name: string; role: string; profile_count: string }

export function assertStagingTarget(input: Input): void {
  const url = new URL(input.databaseUrl)
  if (url.hostname !== stagingHost || url.pathname !== '/sinopebase') {
    throw new Error('Database target is not the isolated Sinope staging server')
  }
  if (url.searchParams.get('sslmode') !== 'require') {
    throw new Error('Staging database connection must require TLS')
  }
}

async function readIdentity(client: PoolClient, email: string): Promise<Existing | null> {
  const result = await client.query<Existing>(
    `SELECT u.id, u.email, u.role, pu.email AS mirror_email,
       (SELECT count(*)::text FROM public.account a WHERE a."userId" = u.id AND a."providerId" = 'credential') AS credential_count
     FROM public."user" u LEFT JOIN public.users pu ON pu.id = u.id
     WHERE lower(u.email) = $1`,
    [email],
  )
  if (result.rowCount && result.rowCount > 1)
    throw new Error('Multiple identities match the requested email')
  return result.rows[0] ?? null
}

async function readMemberships(client: PoolClient, userId: string): Promise<Membership[]> {
  const result = await client.query<Membership>(
    `SELECT m.tenant_id::text, t.name, m.role,
       (SELECT count(*)::text FROM public.company_profiles p WHERE p.tenant_id = t.id) AS profile_count
     FROM public.tenant_memberships m JOIN public.tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1`,
    [userId],
  )
  return result.rows
}

export async function checkState(
  client: PoolClient,
  input: Input,
): Promise<{ userId: string | null; complete: boolean }> {
  const identity = await readIdentity(client, input.email)
  if (identity) {
    if (
      identity.email.toLowerCase() !== input.email ||
      identity.role !== 'user' ||
      identity.mirror_email?.toLowerCase() !== input.email ||
      identity.credential_count !== '1'
    ) {
      throw new Error(
        'Existing identity, mirror, or credential state does not match bootstrap requirements',
      )
    }
    const memberships = await readMemberships(client, identity.id)
    if (memberships.length > 1)
      throw new Error('Requested identity has multiple tenant memberships')
    const member = memberships[0]
    if (member) {
      if (
        member.name !== input.tenantName ||
        member.role !== 'owner' ||
        member.profile_count !== '1'
      ) {
        throw new Error('Existing tenant membership does not match requested owner and profile')
      }
      return { userId: identity.id, complete: true }
    }
  }
  const collision = await client.query(
    'SELECT 1 FROM public.tenants WHERE lower(name) = lower($1) LIMIT 1',
    [input.tenantName],
  )
  if (collision.rowCount) throw new Error('A tenant with the requested name already exists')
  return { userId: identity?.id ?? null, complete: false }
}

export async function bootstrapStaging(
  inputValue: unknown,
  apply: boolean,
  poolFactory = (url: string) => new Pool({ connectionString: url, max: 3 }),
): Promise<'ready' | 'created' | 'complete'> {
  const input = inputSchema.parse(inputValue)
  assertStagingTarget(input)
  const pool = poolFactory(input.databaseUrl)
  try {
    const client = await pool.connect()
    try {
      const db = await client.query<{ current_database: string; current_user: string }>(
        'SELECT current_database(), current_user',
      )
      if (db.rows[0]?.current_database !== 'sinopebase') throw new Error('Unexpected database name')
      // Session lock spans Better Auth's separate pooled connection and the tenant transaction.
      await client.query("SELECT pg_advisory_lock(hashtext('sinope-staging-bootstrap'))")
      try {
        const first = await checkState(client, input)
        if (first.complete) return 'complete'
        if (!apply) return 'ready'
        let userId = first.userId
        if (!userId) {
          if (!input.passwordFile)
            throw new Error('Protected password file required for a new identity')
          const password = (await readFile(input.passwordFile, 'utf8')).replace(/\r?\n$/, '')
          if (password.length < 16 || password.length > 128)
            throw new Error('One-time password must contain 16 to 128 characters')
          const auth = await createAuth(pool)
          await auth.api.signUpEmail({ body: { email: input.email, password, name: '' } })
          const created = await readIdentity(client, input.email)
          if (
            !created ||
            created.mirror_email?.toLowerCase() !== input.email ||
            created.credential_count !== '1'
          ) {
            throw new Error(
              'Better Auth returned without a complete expected identity; inspect before retry',
            )
          }
          userId = created.id
        }
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
        try {
          await client.query('SELECT id FROM public."user" WHERE id = $1 FOR UPDATE', [userId])
          const state = await checkState(client, input)
          if (state.complete) {
            await client.query('COMMIT')
            return 'complete'
          }
          if (state.userId !== userId) throw new Error('Identity changed during bootstrap')
          const tenant = await client.query<{ id: string }>(
            'INSERT INTO public.tenants(name) VALUES($1) RETURNING id',
            [input.tenantName],
          )
          const tenantId = tenant.rows[0]?.id
          if (!tenantId) throw new Error('Tenant insert returned no identifier')
          await client.query(
            "INSERT INTO public.tenant_memberships(user_id, tenant_id, role) VALUES($1, $2, 'owner')",
            [userId, tenantId],
          )
          await client.query(
            'INSERT INTO public.company_profiles(tenant_id, onboarding_completed) VALUES($1, false)',
            [tenantId],
          )
          await client.query('COMMIT')
          return 'created'
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('sinope-staging-bootstrap'))")
      }
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  try {
    if (args.some((arg) => arg !== '--apply') || args.length > 1)
      throw new Error('Unsupported arguments')
    const apply = args.includes('--apply')
    const result = await bootstrapStaging(
      {
        databaseUrl: process.env.DATABASE_URL,
        azureResourceId: process.env.STAGING_AZURE_POSTGRES_RESOURCE_ID,
        email: process.env.STAGING_BOOTSTRAP_EMAIL,
        tenantName: process.env.STAGING_BOOTSTRAP_TENANT_NAME,
        passwordFile: process.env.STAGING_BOOTSTRAP_PASSWORD_FILE,
      },
      apply,
    )
    // Deliberately omit identity, tenant ID, password, and connection details.
    process.stdout.write(`${result}\n`)
  } catch {
    // Provider and database errors can contain identifying values or connection details.
    process.stderr.write('Staging bootstrap failed; inspect private job diagnostics.\n')
    process.exitCode = 1
  }
}
