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

### Client-Side OAuth (GoTrue PKCE)

The official supabase-js SDK signs in and links identities through the GoTrue PKCE flow. Only PKCE (`code_challenge_method=s256`) is accepted; the implicit flow is refused with 400.

```ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient('https://your-instance.example.com', 'your-anon-key', {
  auth: { flowType: 'pkce' },
})

// Sign in or sign up: the browser opens GET /auth/v1/authorize
await sb.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: 'https://yourapp.com/auth/callback' },
})
// On the callback page: grant_type=pkce
await sb.auth.exchangeCodeForSession(code)

// Signed in: link another provider, list and remove identities
await sb.auth.linkIdentity({ provider: 'microsoft', options: { redirectTo } })
const { data } = await sb.auth.getUserIdentities()
await sb.auth.unlinkIdentity(data.identities[0])
```

- `GET /auth/v1/authorize` binds the flow to the browser with an HttpOnly cookie and runs the provider round trip through Better Auth (the provider's registered redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/<provider>`). `GET /auth/v1/oauth/complete` then sends the browser to `redirect_to` with a single-use `code` valid for 5 minutes, or with `error=access_denied&error_code=<reason>` when the sign-in or link is refused. An untrusted `redirect_to` (origin not in `SINOPEBASE_EXTRA_ORIGINS`) falls back to `SINOPEBASE_SITE_URL`.
- `GET /auth/v1/user/identities/authorize` (Bearer) returns the URL a signed-in user opens to link a provider; it carries a single-use, 2-minute ticket instead of the access token.
- `DELETE /auth/v1/user/identities/:identity_id` removes an identity. Removing the last way to log in is refused with 422 `single_identity_not_deletable`. `GET /auth/v1/user` returns `identities`, with the password as provider `email`.
- A user with no password (signed up with a provider) sets a first one with `updateUser({ password })`, without `current_password`, as in GoTrue.

### OAuth Provider Discovery

Clients can discover available OAuth providers at runtime:

```bash
curl 'https://your-instance/api/auth/oauth-providers'
# → { "providers": ["google", "github", "keycloak", ...] }
```

Each provider returns `providerId`, `displayName`, and `iconUrl` for rendering login buttons.

### OAuth via Admin UI

Providers can also be managed through the Admin UI at `/_/` → Settings → OAuth Providers. Add, edit, and remove providers without restarting the server. Provider configuration is persisted to `pb_data/oauth_providers.json`.

This file-based management applies to a single instance. In multi-replica mode, provide identical OAuth settings to every pod through `SINOPEBASE_OAUTH_PROVIDERS_JSON` (for example, from a private Kubernetes Secret). Startup rejects a local `oauth_providers.json` file, and Admin UI provider mutations are disabled. Roll all pods when changing providers. See [Kubernetes deployment](kubernetes.md).

### Identity Linking Policy

Which provider identity may sign in, create a user, or link to an existing one is decided by one pure module, `src/tools/auth-better/identity-linking-policy.ts`, enforced in Better Auth's `validateUserInfo` hook:

- An identity already linked signs in as its user.
- A new identity whose email matches an existing user links to it only when both the provider and the local account have a verified email, and only for Google, the one provider whose email claim is treated as authoritative. Otherwise the sign-in is refused (`provider_email_unverified`, `local_email_unverified`, `email_claim_not_authoritative`); the user signs in another way and links from their account.
- Microsoft (built-in provider, tenant `organizations` by default) is keyed by the token's `tid` and `oid`, never by email. Its email claim is not authoritative, so a Microsoft identity never links by email, and users it creates have an unverified email.
- An explicit link (`linkIdentity`) links the provider account to the signed-in user, unless it is already linked to someone else (`account_already_linked_to_different_user`). A new link counts only once its code is redeemed with the verifier of the browser that asked for it; until then the identity signs in to nobody (`identity_link_pending`), and a wrong verifier or an abandoned code removes it.
- A recovery link that confirms an address for the first time removes the account's provider identities and sessions.

## Account Deletion

`DELETE /auth/v1/user` (Bearer: a session token) deletes the caller's own account. GoTrue has no self-delete, so it follows GoTrue's soft delete. The user row stays as a tombstone so that records naming its id keep their key: `deletedAt` is set, the address becomes `deleted-<id>@deleted.invalid` (the real address can be used again), and the name, image and metadata are cleared. In the same transaction, every session, refresh token, password, linked identity, pending recovery or email-change link and agent grant of the user is removed. It answers `200 {}`.

- The session must have signed in within the last 10 minutes (Better Auth's `freshAge` idea); otherwise `400 reauthentication_needed`. Sign in again, with a password or a provider, then retry.
- Agent grant tokens, the anon key and the service role key are refused (`401`).
- A deployment can veto a deletion with a `BEFORE UPDATE` trigger on `public."user"` that raises `restrict_violation` (SQLSTATE `23001`) when `deletedAt` is set. The answer is then `409 user_deletion_restricted`, nothing changes, and the trigger's message is not returned. Sinope uses this to refuse the last owner of a company.

First-party requests also carry `auth_time` (epoch seconds) in `request.jwt.claims`: when their session signed in. A refresh never moves it. A database can use it to require a recent sign-in before a destructive change.

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
| `BETTER_AUTH_URL` | Public-facing base URL for OAuth callbacks | `http://localhost:8090` |
| `ALLOW_SIGNUPS` | Public email/password signup | Disabled in production; enabled in development |
| `GOOGLE_CLIENT_ID` | Google OAuth client (built-in provider `google`) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | — |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra app client (built-in provider `microsoft`) | — |
| `MICROSOFT_CLIENT_SECRET` | Microsoft Entra app secret | — |
| `MICROSOFT_TENANT_ID` | Entra tenant, or `organizations` for any work or school account | `organizations` |

## Security

- JWT tokens are HMAC-SHA256 signed. Set `JWT_SECRET` to a strong random value in production.
- Public signup fails closed in production. Set `ALLOW_SIGNUPS=true` only when self-service account creation is intended.
- Refresh tokens are rotated on each use. Old tokens are invalidated immediately.
- Bearer tokens are validated via direct database lookup (not cookie-based).
- Password minimum length is enforced by better-auth (8 characters default).
- Rate limiting is enabled by default (1000 req/min). Auth endpoints are rate-limited.
- OAuth `clientSecret` is redacted in API responses (POST returns masked value).
- Timing-safe key comparison (`crypto.timingSafeEqual`) for realtime and auth operations.
