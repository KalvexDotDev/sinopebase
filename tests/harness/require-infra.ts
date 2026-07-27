/**
 * Fail-closed infrastructure requirement helpers.
 *
 * These are convenience wrappers over the more flexible gateInfrastructure()
 * API in ./infrastructure.ts. They throw RequiredInfrastructureError when
 * the corresponding environment variables are not set or are invalid.
 *
 * Use these in test files that unconditionally need PostgreSQL, object
 * storage, or auth credentials. For suites that should skip gracefully
 * when infra is absent, use gateInfrastructure() with onMissing: 'skip'
 * and a skipReason.
 */

import type { InfrastructureReady } from './infrastructure'
import {
  gateInfrastructure,
  OBJECT_STORAGE_REQUIREMENTS,
  POSTGRES_REQUIREMENTS,
} from './infrastructure'

export interface RustFSConfig {
  readonly endpoint: string
  readonly accessKey: string
  readonly secretKey: string
}

/**
 * Require a valid TEST_POSTGRES_URL to be set.
 * Falls back to POSTGRES_URL if TEST_POSTGRES_URL is not set
 * (backward-compatible with existing .env files).
 * Throws RequiredInfrastructureError if both are missing or invalid.
 */
export function requirePostgres(): string {
  // Allow POSTGRES_URL as fallback for backward compatibility
  const env = { ...process.env } as Record<string, string | undefined>
  if (!env.TEST_POSTGRES_URL && env.POSTGRES_URL) {
    env.TEST_POSTGRES_URL = env.POSTGRES_URL
  }
  const gate = gateInfrastructure({
    suiteId: 'require-infra',
    requirements: POSTGRES_REQUIREMENTS,
    environment: env,
  })
  return (gate as InfrastructureReady).values.TEST_POSTGRES_URL
}

/**
 * Require all RUSTFS_* variables (endpoint, access key, secret key) to be set.
 * Throws RequiredInfrastructureError if any are missing or invalid.
 */
export function requireRustFS(): RustFSConfig {
  const gate = gateInfrastructure({
    suiteId: 'require-infra',
    requirements: OBJECT_STORAGE_REQUIREMENTS,
  })
  const ready = gate as InfrastructureReady
  return {
    endpoint: ready.values.RUSTFS_ENDPOINT,
    accessKey: ready.values.RUSTFS_ACCESS_KEY,
    secretKey: ready.values.RUSTFS_SECRET_KEY,
  }
}

/**
 * Require SINOPEBASE_ANON_KEY to be set.
 * Throws RequiredInfrastructureError if missing.
 */
export function requireAnonKey(): string {
  const gate = gateInfrastructure({
    suiteId: 'require-infra',
    requirements: [{ name: 'SINOPEBASE_ANON_KEY', secret: true }],
  })
  return (gate as InfrastructureReady).values.SINOPEBASE_ANON_KEY
}

/**
 * Require SINOPEBASE_SERVICE_ROLE_KEY to be set.
 * Throws RequiredInfrastructureError if missing.
 */
export function requireServiceRoleKey(): string {
  const gate = gateInfrastructure({
    suiteId: 'require-infra',
    requirements: [{ name: 'SINOPEBASE_SERVICE_ROLE_KEY', secret: true }],
  })
  return (gate as InfrastructureReady).values.SINOPEBASE_SERVICE_ROLE_KEY
}
