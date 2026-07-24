/**
 * ATDD Test Harness Setup
 *
 * Sinopebase acceptance tests are ported from supabase-js integration tests.
 * Tests call the Sinopebase SDK, which wraps the backend REST API.
 * These tests drive implementation: each test defines what the backend must support.
 */

import { createClient, type SinopebaseClient } from '../../src/sdk/client'

/**
 * Lazy-validated credential accessors.
 * Throws on missing env vars to prevent silent fallback to test defaults.
 */

/** Base URL for the local Sinopebase backend (defaults to localhost:8090) */
function getSinopebaseUrl(): string {
  return process.env['SINOPEBASE_URL']?.trim() || 'http://127.0.0.1:8090'
}

/** Require SINOPEBASE_ANON_KEY — throws if not set */
function getAnonKey(): string {
  const value = process.env['SINOPEBASE_ANON_KEY']?.trim()
  if (!value) {
    throw new Error(
      'SINOPEBASE_ANON_KEY must be set for infrastructure contract tests.\n' +
      '  export SINOPEBASE_ANON_KEY=<your-anon-key>\n' +
      '  This prevents silent fallback to a hard-coded test credential.',
    )
  }
  return value
}

/** Require SINOPEBASE_SERVICE_ROLE_KEY — throws if not set */
function getServiceRoleKey(): string {
  const value = process.env['SINOPEBASE_SERVICE_ROLE_KEY']?.trim()
  if (!value) {
    throw new Error(
      'SINOPEBASE_SERVICE_ROLE_KEY must be set for infrastructure contract tests.\n' +
      '  export SINOPEBASE_SERVICE_ROLE_KEY=<your-service-role-key>\n' +
      '  This prevents silent fallback to a hard-coded test credential.',
    )
  }
  return value
}

/**
 * Create a client configured for the local Sinopebase backend.
 * Mirrors supabase-js: createClient(url, key)
 */
export function createTestClient(key?: string): SinopebaseClient {
  return createClient(getSinopebaseUrl(), key ?? getAnonKey())
}

export function createServiceClient(): SinopebaseClient {
  return createClient(getSinopebaseUrl(), getServiceRoleKey())
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
