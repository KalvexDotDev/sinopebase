import { describe, expect, it } from 'bun:test'
import { betterAuth } from 'better-auth'

function testAuth() {
  return betterAuth({
    secret: 'synthetic-test-secret-with-at-least-32-characters',
    baseURL: 'http://localhost:8090',
    socialProviders: {
      google: {
        clientId: 'synthetic-client',
        clientSecret: 'synthetic-secret',
        disableSignUp: true,
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

async function idTokenRequest(
  auth: ReturnType<typeof testAuth>,
  email: string,
  requestSignUp: boolean,
) {
  const context = await auth.$context
  const provider = context.socialProviders.find((candidate) => candidate.id === 'google')
  if (!provider) throw new Error('Google provider missing')
  provider.verifyIdToken = async () => true
  provider.getUserInfo = async () => ({
    user: { id: `google-${email}`, email, name: 'Synthetic User', emailVerified: true },
    data: {},
  })
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

describe('Better Auth patched ID-token social signup', () => {
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
