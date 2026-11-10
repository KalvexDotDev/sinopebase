import type { AppConfig } from '~/core/app.ts'
import { parseTrustedProxies } from '~/core/config'

type DeploymentConfig = Pick<
  AppConfig,
  'enablePgNotify' | 'multiReplica' | 'externalRateLimit' | 'trustedProxies' | 'rateLimitMax'
>

/** Requests per client per window. Unset keeps the built-in default; a bad value refuses to start. */
function rateLimitMaxFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined
  const max = Number(value)
  if (!Number.isSafeInteger(max) || max < 1)
    throw new Error('SINOPEBASE_RATE_LIMIT_MAX must be a positive integer')
  return max
}

/** Deployment flags are opt-in so the existing single-instance CLI defaults remain intact. */
export function deploymentConfigFromEnv(env: NodeJS.ProcessEnv): DeploymentConfig {
  return {
    enablePgNotify: env.SINOPEBASE_PG_NOTIFY === 'true',
    multiReplica: env.SINOPEBASE_MULTI_REPLICA === 'true',
    externalRateLimit: env.SINOPEBASE_EXTERNAL_RATE_LIMIT === 'true',
    trustedProxies: parseTrustedProxies(env.TRUSTED_PROXIES),
    rateLimitMax: rateLimitMaxFromEnv(env.SINOPEBASE_RATE_LIMIT_MAX),
  }
}
