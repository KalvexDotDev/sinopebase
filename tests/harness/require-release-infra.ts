#!/usr/bin/env bun
/**
 * Release test infrastructure gate.
 *
 * This script is invoked by the "test:release" npm script before running
 * any release tests. It validates that TEST_POSTGRES_URL is set and exits
 * with code 1 if not, preventing release suites from silently falling back
 * to in-memory databases when PostgreSQL is expected.
 *
 * Dev-friendly workflows (bun test, bun run test:component) are unaffected
 * and continue to work with the in-memory fallback.
 */

import { gateInfrastructure, POSTGRES_REQUIREMENTS } from './infrastructure'

const message =
  'TEST_POSTGRES_URL must be set for release tests.\n' +
  '  export TEST_POSTGRES_URL=postgresql://user:pass@host:5432/db\n' +
  '  To run developer tests without PostgreSQL, use: bun test'

try {
  gateInfrastructure({
    suiteId: 'release',
    requirements: POSTGRES_REQUIREMENTS,
  })
  console.error('TEST_POSTGRES_URL is set -- running release tests')
  process.exit(0)
} catch {
  console.error(message)
  process.exit(1)
}
