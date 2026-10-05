# Roadmap

Sinopebase prioritizes compatibility and production use. See the [changelog](../CHANGELOG.md) for release details.

## v0.10.0 release

- PostgreSQL, S3-compatible storage, email/password and OAuth/OIDC auth, realtime channels and presence, edge functions, AI features, and the admin UI.
- Railway single-instance and Docker deployment paths remain supported with the existing defaults.
- PostgREST `match`/`imatch` regex filters, improved admin journeys, server-side SMTP environment configuration, and signed-download fixes.
- Opt-in Kubernetes multi-replica support on the same image: serialized PostgreSQL migrations, cross-replica row-change notifications, database-aware readiness, HTTPS S3 endpoint defaults, and a generic manifest validated in CI.
- Production signup is closed unless explicitly enabled. CI includes new-code coverage, test-polarity, and changed-line mutation gates.

## After the release

Record the versioned image's immutable registry digest before adopting it. Cluster-specific Atlas configuration and deployment happen privately after release. [Kubernetes deployment](kubernetes.md) documents the required shared services and current limits, including process-local presence, broadcasts, and rate limits.

## Toward 1.0

- Complete signed URL cryptography and supply-chain attestation.
- Prove backup and restore recovery targets and publish benchmarks.
- Continue closing compatibility gaps in the SDK and PostgREST APIs.

## Longer term

- AI-assisted backend creation, payments, one-command self-hosting, local development options, and offline sync remain ideas for later releases; they are not part of v0.10.0.

## Explicitly outside the current scope

- Managed cloud hosting, Supabase Studio parity, and multi-tenant SaaS.
