/**
 * Shared Application Context
 *
 * Passed to all route handlers. Mirrors PocketBase's core.App interface
 * but scoped to what each domain needs during porting.
 */

import type { Database } from './db'

export interface AppContext {
  /** Database layer */
  db: Database

  /** Base URL for constructing public URLs */
  baseUrl: string

  /** Auth configuration */
  auth: {
    /** better-auth instance (set during Phase 2) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instance: any
  }

  /** Storage configuration */
  storage: {
    endpoint: string
    accessKey: string
    secretKey: string
    /** MinIO client (set during Phase 3) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any
  }
}
