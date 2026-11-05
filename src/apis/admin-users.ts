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

/** A plain-text notice for one registered user. No addresses, no HTML, no attachments. */
const notice = z.strictObject({
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(5000),
})

/** Sends one message through the configured SMTP mailer; false when none is configured. */
export type DeliverMail = (mail: { to: string; subject: string; text: string }) => Promise<boolean>

/** The login address of a registered user, or null. */
async function userEmail(db: Kysely<BetterAuthDatabase>, id: string): Promise<string | null> {
  const rows = await sql<{
    email: string
  }>`SELECT email FROM public."user" WHERE id = ${id}`.execute(db)
  return rows.rows[0]?.email ?? null
}

/**
 * Service-only user administration: provisioning (no public signup policy changes, sessions
 * or tenant grants), and a plain-text notice to one registered user by id (sinope#1104
 * overdue nudges). The caller never supplies an address, so the notice route can only ever
 * mail an account holder, at the address they sign in with.
 */
export function createAdminUsersPlugin(
  db: Kysely<BetterAuthDatabase>,
  serviceKey: string | undefined,
  deliver?: DeliverMail,
) {
  return new Elysia()
    .post('/auth/v1/admin/users', async ({ request, body, set }) => {
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
    .post('/auth/v1/admin/users/:id/mail', async ({ request, params, body, set }) => {
      if (!authorized(request, serviceKey)) {
        set.status = 403
        return { message: 'Service authorization required.' }
      }
      const parsed = notice.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return {
          message: 'A subject of at most 200 and a text of at most 5000 characters required.',
        }
      }
      let to: string | null
      try {
        to = await userEmail(db, params.id)
      } catch {
        set.status = 503
        return { message: 'The user could not be read.' }
      }
      if (!to) {
        set.status = 404
        return { message: 'User not found.' }
      }
      try {
        // Not configured is a refusal, never a silent success: the caller must not record it sent.
        if (!deliver || !(await deliver({ to, ...parsed.data }))) {
          set.status = 503
          return { message: 'Mail is not configured.' }
        }
      } catch {
        // SMTP errors can echo the address; never forward or log them.
        set.status = 502
        return { message: 'The mail could not be sent.' }
      }
      set.status = 202
      return { sent: true }
    })
}
