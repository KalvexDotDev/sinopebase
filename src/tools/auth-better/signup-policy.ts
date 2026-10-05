import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'

/** Shared registration policy for compatibility, native, and OAuth signup. */
export function signupsAllowed(): boolean {
  if (process.env.SINOPEBASE_PRODUCTION === 'true') return process.env.ALLOW_SIGNUPS === 'true'
  return process.env.ALLOW_SIGNUPS !== 'false'
}

/** Apply registration policy before native or OAuth account persistence. */
export function createAuthWithSignupPolicy(
  options: Omit<Parameters<typeof betterAuth>[0], 'databaseHooks'>,
): ReturnType<typeof betterAuth> {
  return betterAuth<Parameters<typeof betterAuth>[0]>({
    ...options,
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!signupsAllowed()) {
              throw new APIError('FORBIDDEN', { message: 'Signups are currently invite-only.' })
            }
          },
        },
      },
    },
  })
}
