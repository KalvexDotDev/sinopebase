import { describe, expect, it } from 'bun:test'
import { betterAuth } from 'better-auth'

/** The email the synthetic provider reports for the next ID-token sign-in. */
let providerEmail = ''

function testAuth() {
  return betterAuth({
    secret: 'synthetic-test-secret-with-at-least-32-characters',
    baseURL: 'http://localhost:8090',
    socialProviders: {
      google: {
        clientId: 'synthetic-client',
        clientSecret: 'synthetic-secret',
        disableSignUp: true,
        // Better Auth's integrator overrides stand in for Google's JWKS and profile.
        verifyIdToken: async () => true,
        getUserInfo: async () => ({
          user: { email: providerEmail, name: 'Synthetic User', emailVerified: true },
          data: {
            iss: 'https://accounts.google.com',
            aud: 'synthetic-client',
            azp: 'synthetic-client',
            sub: `google-${providerEmail}`,
            email: providerEmail,
            email_verified: true,
            name: 'Synthetic User',
            given_name: 'Synthetic',
            family_name: 'User',
            picture: '',
            iat: 0,
            exp: 0,
          },
        }),
      },
    },
    emailAndPassword: { enabled: true },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        requireLocalEmailVerified: false,
      },
    },
  })
}

function idTokenRequest(auth: ReturnType<typeof testAuth>, email: string, requestSignUp: boolean) {
  providerEmail = email
  return auth.handler(
    new Request('http://localhost:8090/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        idToken: { token: 'synthetic-verified-token' },
        requestSignUp,
      }),
    }),
  )
}

describe('Better Auth ID-token social signup policy', () => {
  it('rejects a new identity even when requestSignUp is true', async () => {
    const auth = testAuth()
    const response = await idTokenRequest(auth, 'new@example.test', true)
    expect(response.status).toBe(401)
    const context = await auth.$context
    expect(await context.internalAdapter.findUserByEmail('new@example.test')).toBeNull()
  })

  it('still signs in an existing identity through a verified provider ID token', async () => {
    const auth = testAuth()
    await auth.api.signUpEmail({
      body: {
        email: 'existing@example.test',
        password: 'synthetic-password-123',
        name: 'Existing',
      },
    })
    const response = await idTokenRequest(auth, 'existing@example.test', false)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { user: { email: string } }).user.email).toBe(
      'existing@example.test',
    )
  })
})
