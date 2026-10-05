# Roadmap

Sinopebase prioritizes compatibility and production use. See the [changelog](../CHANGELOG.md) for released versions; the package is currently at v0.9.0.

## Current release: v0.9.0

- PostgreSQL, S3-compatible storage, email/password and OAuth/OIDC auth, realtime channels and presence, edge functions, AI features, and the admin UI.
- Railway single-instance and Docker deployment paths.
- Production signup is closed unless explicitly enabled. CI includes new-code coverage, test-polarity, and changed-line mutation gates.

## Next: Kubernetes multi-replica release

The in-progress release uses the existing image with opt-in configuration. It adds serialized PostgreSQL startup migrations, cross-replica database-change notifications, PostgreSQL-aware readiness, S3 HTTPS endpoint defaults, and a generic Kubernetes manifest validated in CI. Railway's existing single-instance defaults remain supported.

Before publishing, complete the release tests and produce a versioned image with an immutable registry digest. Cluster-specific configuration and deployment happen separately after release. [Kubernetes deployment](kubernetes.md) documents the required shared services and current limits, including process-local presence, broadcasts, and rate limits.

## Toward 1.0

- Complete signed URL cryptography and supply-chain attestation.
- Prove backup and restore recovery targets and publish benchmarks.
- Continue closing compatibility gaps in the SDK and PostgREST APIs.

## Longer term

- AI-assisted backend creation, payments, one-command self-hosting, local development options, and offline sync remain ideas for later releases; they are not part of the Kubernetes release.

## Explicitly outside the current scope

- Managed cloud hosting, Supabase Studio parity, and multi-tenant SaaS.
