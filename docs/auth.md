# Auth & SSO

Sinopebase uses [better-auth](https://better-auth.com) v1.6 for authentication. Email/password, OAuth/OIDC, and enterprise SSO via Keycloak as a SAML broker.

## Quick Start

```ts
import { createClient } from 'sinopebase'
const sb = createClient('http://localhost:8090', 'your-anon-key')

// Sign up
await sb.auth.signUp({ email: 'user@example.com', password: 'secure-password' })

// Sign in
const { data } = await sb.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'secure-password'
})

// Get current user
const { data: { user } } = await sb.auth.getUser()

// Sign out
await sb.auth.signOut()
```

## OAuth / Social Login

Configure providers in `Sinopebase` startup:

```ts
import { Sinopebase } from 'sinopebase'

const app = new Sinopebase({
  postgresUrl: 'postgresql://localhost:5432/sinopebase',
  oauthProviders: [
    {
      providerId: 'google',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    {
      providerId: 'github',
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  ],
})
await app.start()
```

### Built-in Providers

Better-auth provides built-in social providers for major platforms. Configure them via the `socialProviders` option (no plugin needed):

| Provider | `providerId` | Type |
|----------|-------------|------|
| Google | `google` | Built-in social |
| GitHub | `github` | Built-in social |
| Discord | `discord` | Built-in social |
| Apple | `apple` | Built-in social |
| Microsoft | `microsoft` | Built-in social |
| Spotify | `spotify` | Built-in social |
| GitLab | `gitlab` | Built-in social |

For enterprise SSO (Keycloak, Okta, Auth0, Entra ID), use the `genericOAuth` plugin which maps `issuer` → `discoveryUrl` (the OIDC `.well-known/openid-configuration` endpoint).

### Microsoft Entra ID (Azure AD)

```ts
oauthProviders: [{
  providerId: 'microsoft-entra-id',
  clientId: process.env.AZURE_CLIENT_ID,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
  tenantId: process.env.AZURE_TENANT_ID,  // 'organizations' for multi-tenant
}]
```

### Account Linking

Accounts are linked by email by default. A user signing in with Google
and GitHub using the same email gets one account with both providers linked.

```ts
const app = new Sinopebase({
  postgresUrl: '...',
  oauthProviders: [...],
})
// accountLinking is enabled automatically for configured providers
```

## Enterprise SSO

### Path A: Direct OIDC (recommended)

Most enterprise IdPs support OIDC. Use the `genericOAuth` plugin directly:

```
┌─────────────────────────────────┐
│  Azure AD / Okta / Google        │
│  ↓ OIDC                          │
│  Sinopebase (better-auth)        │
└─────────────────────────────────┘
```

```ts
oauthProviders: [{
  providerId: 'microsoft-entra-id',
  clientId: '...', clientSecret: '...', tenantId: '...',
}]
```

### Path B: SAML via Keycloak

For IdPs that only speak SAML (Ping, Shibboleth, legacy ADFS), run Keycloak
as a SAML-to-OIDC bridge:

```
┌─────────────────────────────────┐
│  Any SAML IdP                    │
│  ↓ SAML                          │
│  Keycloak (self-hosted)          │
│  ↓ OIDC                          │
│  Sinopebase (better-auth)        │
└─────────────────────────────────┘
```

```ts
oauthProviders: [{
  providerId: 'keycloak',
  clientId: process.env.KEYCLOAK_CLIENT_ID,
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  issuer: 'https://keycloak.example.com/realms/myorg',
}]
```

Keycloak is not bundled — it's enterprise infrastructure. Set up Keycloak,
configure the SAML IdP as an identity provider, then point Sinopebase at
Keycloak's OIDC endpoint.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `JWT_SECRET` | JWT signing secret | **Must set in production** |
| `POSTGRES_URL` | Database connection | `postgresql://localhost:5432/sinopebase` |
| `GOOGLE_CLIENT_ID` | Google OAuth client | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | — |
| `AZURE_CLIENT_ID` | Entra ID client | — |
| `AZURE_CLIENT_SECRET` | Entra ID secret | — |
| `AZURE_TENANT_ID` | Entra ID tenant | — |

## Security

- JWT tokens are HMAC-SHA256 signed. Set `JWT_SECRET` to a strong random value in production.
- Refresh tokens are rotated on each use. Old tokens are invalidated immediately.
- Bearer tokens are validated via direct database lookup (not cookie-based).
- Password minimum length is enforced by better-auth (8 characters default).
- Rate limiting on auth endpoints is planned for v0.4.
