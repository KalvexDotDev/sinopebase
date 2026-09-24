import { hashPassword } from 'better-auth/crypto'
import { Elysia } from 'elysia'
import type pg from 'pg'
import { z } from 'zod'

const credentials = z.strictObject({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
})

/** Service-only provisioning. Public signup policy, sessions and tenant grants are untouched. */
export function createAdminUsersPlugin(pool: pg.Pool, isService: (request: Request) => boolean) {
  return new Elysia({ name: 'sinopebase-admin-users' }).post(
    '/auth/v1/admin/users',
    async ({ request, body, set }) => {
      if (!isService(request)) {
        set.status = 403
        return { message: 'Service authorization required.' }
      }
      const parsed = credentials.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { message: 'Valid email and a password between 12 and 128 characters required.' }
      }
      // Never accept roles, verification flags, tenant grants or arbitrary metadata.
      // Hash with the same Better Auth primitive used by email/password sign-in.
      const { email, password } = parsed.data
      let client: pg.PoolClient | undefined
      try {
        const hash = await hashPassword(password)
        client = await pool.connect()
        await client.query('BEGIN')
        // Installed by an owner-authorized migration, never by the request runtime.
        // Fail closed until all identity writers share case-insensitive uniqueness.
        const invariant = await client.query<{ ready: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_index i
            WHERE i.indexrelid = to_regclass('public.better_auth_user_email_unique')
              AND i.indrelid = 'public.user'::regclass AND i.indisunique AND i.indisvalid
              AND i.indpred IS NULL AND i.indnkeyatts = 1
              AND pg_get_expr(i.indexprs, i.indrelid) = 'lower((email)::text)'
          ) AS ready`)
        if (!invariant.rows[0]?.ready) {
          await client.query('ROLLBACK')
          set.status = 503
          return { message: 'Account provisioning requires the identity migration.' }
        }
        const id = crypto.randomUUID()
        await client.query(
          `INSERT INTO public."user" (id, email, "emailVerified", name, role)
           VALUES ($1, $2, false, '', 'user')`,
          [id, email],
        )
        await client.query(
          `INSERT INTO public.account (id, "userId", "providerId", "accountId", password)
           VALUES ($1, $2, 'credential', $2, $3)`,
          [crypto.randomUUID(), id, hash],
        )
        await client.query('COMMIT')
        set.status = 201
        return { user: { id, email } }
      } catch (error: unknown) {
        if (client) await client.query('ROLLBACK').catch(() => undefined)
        // Never return or log driver errors, which may include credentials or identity data.
        const duplicate = error instanceof Error && 'code' in error && error.code === '23505'
        set.status = duplicate ? 409 : 503
        return {
          message: duplicate
            ? 'Account already exists.'
            : 'Account creation could not be confirmed.',
        }
      } finally {
        client?.release()
      }
    },
  )
}
