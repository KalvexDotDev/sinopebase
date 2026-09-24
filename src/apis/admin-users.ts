import { hashPassword } from 'better-auth/crypto'
import { Elysia } from 'elysia'
import { type Kysely, sql } from 'kysely'
import { z } from 'zod'
import type { BetterAuthDatabase } from '~/tools/auth-better/adapter'
import { Equal } from '~/tools/security/crypto'

const credentials = z.strictObject({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
})

function authorized(request: Request, serviceKey: string | undefined): boolean {
  if (!serviceKey) return false
  const header = request.headers.get('authorization')
  return typeof header === 'string' && Equal(header, `Bearer ${serviceKey}`)
}

function creationFailure(error: unknown) {
  const duplicate = z.object({ code: z.literal('23505') }).safeParse(error).success
  return duplicate
    ? { status: 409, message: 'Account already exists.' }
    : { status: 503, message: 'Account creation could not be confirmed.' }
}

async function provision(db: Kysely<BetterAuthDatabase>, input: z.infer<typeof credentials>) {
  const hash = await hashPassword(input.password)
  return db.transaction().execute(async (tx) => {
    // Owner-installed migration, never request-time DDL. Require uniqueness
    // across all identity writers, including native Better Auth signup.
    const invariant = await sql`SELECT i.indexrelid FROM pg_index i
      WHERE i.indexrelid = to_regclass('public.better_auth_user_email_unique')
        AND i.indrelid = 'public.user'::regclass AND i.indisunique AND i.indisvalid
        AND i.indpred IS NULL AND i.indnkeyatts = 1
        AND pg_get_expr(i.indexprs, i.indrelid) = 'lower((email)::text)'
    `.execute(tx)
    if (invariant.rows.length !== 1) throw new Error()
    const id = crypto.randomUUID()
    await sql`INSERT INTO public."user" (id, email, "emailVerified", name, role)
      VALUES (${id}, ${input.email}, false, '', 'user')`.execute(tx)
    await sql`INSERT INTO public.account (id, "userId", "providerId", "accountId", password)
      VALUES (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${hash})`.execute(tx)
    return { id, email: input.email }
  })
}

/** Service-only provisioning: no public signup policy changes, sessions or tenant grants. */
export function createAdminUsersPlugin(
  db: Kysely<BetterAuthDatabase>,
  serviceKey: string | undefined,
) {
  return new Elysia().post('/auth/v1/admin/users', async ({ request, body, set }) => {
    if (!authorized(request, serviceKey)) {
      set.status = 403
      return { message: 'Service authorization required.' }
    }
    const parsed = credentials.safeParse(body)
    if (!parsed.success) {
      set.status = 400
      return { message: 'Valid email and a password between 12 and 128 characters required.' }
    }
    try {
      const user = await provision(db, parsed.data)
      set.status = 201
      return { user }
    } catch (error: unknown) {
      // Driver errors can contain credentials and identity data; never forward or log them.
      const failure = creationFailure(error)
      set.status = failure.status
      return { message: failure.message }
    }
  })
}
