import type { AppConfig } from '~/core/app.ts'
import { parseTrustedProxies } from '~/core/config'

type DeploymentConfig = Pick<
  AppConfig,
  'enablePgNotify' | 'multiReplica' | 'externalRateLimit' | 'trustedProxies'
>

/** Deployment flags are opt-in so the existing single-instance CLI defaults remain intact. */
export function deploymentConfigFromEnv(env: NodeJS.ProcessEnv): DeploymentConfig {
  return {
    enablePgNotify: env.SINOPEBASE_PG_NOTIFY === 'true',
    multiReplica: env.SINOPEBASE_MULTI_REPLICA === 'true',
    externalRateLimit: env.SINOPEBASE_EXTERNAL_RATE_LIMIT === 'true',
    trustedProxies: parseTrustedProxies(env.TRUSTED_PROXIES),
  }
}
