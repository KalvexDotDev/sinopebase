# Private staging account and tenant bootstrap

Ticket: Sinopebase #26; application admin scope: Sinope #260.

Build `Dockerfile.staging-bootstrap` into a private image. Run it as a one-shot Azure Container Apps job in the **staging** Container Apps environment and subnet, with no ingress. Define the job and secret references through the staging Pulumi stack. The image contains only the maintenance executable; the normal Sinopebase server image does not contain it.

Supply these values from the Pulumi-managed staging job:

| Variable | Source |
| --- | --- |
| `DATABASE_URL` | Private staging PostgreSQL URL; host exactly `pg-sinope-staging.postgres.database.azure.com`, database `sinopebase`, `sslmode=require`. Keep the password in Key Vault. |
| `STAGING_AZURE_POSTGRES_RESOURCE_ID` | Full ARM ID of `pg-sinope-staging` in `rg-sinope-staging`. |
| `STAGING_BOOTSTRAP_EMAIL` | Exact independently verified account email. |
| `STAGING_BOOTSTRAP_TENANT_NAME` | Fresh tenant display name. |
| `STAGING_BOOTSTRAP_PASSWORD_FILE` | Path to a protected one-time password secret mount. The file may have one final newline. Never pass the password through argv, migration storage, logs, or a committed file. |

Default invocation is read-only and returns `ready` or `complete`. Invoke with `--apply` for the authorized one-time write. A successful first run returns `created`; a repeated run returns `complete`. The identity is created through Better Auth's internal API while public signup remains disabled. Tenant, owner membership and company profile commit together. If identity creation succeeds but the tenant transaction fails, rerun after inspecting the state; the same identity can be resumed without changing its password. Any different membership, mirror, credential or tenant collision stops the job.

Before applying: verify the isolated G2 database and migration set, deployed closed-signup fix (#22), exact owner email, and that the job targets only the staging private network. Do not use production credentials or data. Deliver the one-time password through a protected channel and rotate it after first sign-in. Retain no password in the job definition after completion. The CLI prints only its status; errors are intentionally generic to avoid disclosing credentials or account data in ACA logs.
