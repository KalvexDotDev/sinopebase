/**
 * ATDD Test Harness Setup
 *
 * Sinopebase acceptance tests are ported from supabase-js integration tests.
 * Tests call the Sinopebase SDK, which wraps the backend REST API.
 * These tests drive implementation: each test defines what the backend must support.
 */

import { createClient, type SinopebaseClient } from '../../src/sdk/client'

/** Base URL for the local Sinopebase backend */
const SINOPEBASE_URL = process.env.SINOPEBASE_URL ?? 'http://127.0.0.1:8090'

/** Service role key for admin operations (bypasses RLS) */
const SERVICE_ROLE_KEY = process.env.SINOPEBASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'

/** Anon key for public operations */
const ANON_KEY = process.env.SINOPEBASE_ANON_KEY ?? 'test-anon-key'

/**
 * Create a client configured for the local Sinopebase backend.
 * Mirrors supabase-js: createClient(url, key)
 */
export function createTestClient(key: string = ANON_KEY): SinopebaseClient {
  return createClient(SINOPEBASE_URL, key)
}

export function createServiceClient(): SinopebaseClient {
  return createClient(SINOPEBASE_URL, SERVICE_ROLE_KEY)
}

/**
 * Generate unique test data to avoid collisions.
 * Mirrors supabase-js test patterns (Date.now() for unique emails).
 */
export function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sinopebase.test`
}

export function uniqueId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Test fixtures — mirror the supabase-js integration test schema
// ---------------------------------------------------------------------------

/**
 * The 'todos' table schema expected by supabase-js PostgREST tests.
 * We must create this collection in Sinopebase before running tests.
 */
export const TODOS_SCHEMA = {
  name: 'todos',
  fields: [
    { name: 'task', type: 'text', required: true },
    { name: 'is_complete', type: 'bool', required: false },
    { name: 'user_id', type: 'text', required: false },
  ],
} as const

/**
 * Test bucket for storage tests (mirrors supabase-js 'test-bucket').
 */
export const TEST_BUCKET = 'test-bucket'

// ---------------------------------------------------------------------------
// Polling helper — mirrors supabase-js realtime test pattern
// ---------------------------------------------------------------------------

/**
 * Poll until a condition is met or timeout.
 * Used in realtime tests (100ms interval, 50 attempts max).
 */
export async function pollUntil(
  fn: () => boolean | Promise<boolean>,
  intervalMs = 100,
  maxAttempts = 50,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await fn()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Condition not met after ${maxAttempts * intervalMs}ms`)
}
