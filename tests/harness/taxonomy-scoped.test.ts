/**
 * Scoped unit tests for test taxonomy classification.
 *
 * Tests classifyTestFile against a minimal in-memory taxonomy — no file
 * discovery, no wave0 JSON files, no CI-specific drift. This replaces the
 * "classifies every test once" integration test that required a full repo
 * scan and synchronized inventory files.
 */

import { describe, expect, it } from 'bun:test'
import { classifyTestFile, parseTestTaxonomy, type TestTaxonomy } from './taxonomy'

const minimalTaxonomy: TestTaxonomy = {
  schemaVersion: 1,
  testRunIdEnvironment: 'TEST_RUN_ID',
  suites: [
    {
      id: 'unit',
      kind: 'unit',
      releaseRequired: false,
      include: ['src/**/*.test.ts'],
      exclude: [],
      infrastructure: [],
      onMissingInfrastructure: 'skip',
      fallbackPolicy: 'allow',
      isolation: {
        process: 'shared',
        port: 'none',
        namespace: 'none',
        filesystem: 'none',
      },
    },
    {
      id: 'component',
      kind: 'component',
      releaseRequired: false,
      include: ['tests/**/*.test.ts'],
      exclude: [],
      infrastructure: [],
      onMissingInfrastructure: 'skip',
      fallbackPolicy: 'allow',
      isolation: {
        process: 'per-file',
        port: 'dynamic',
        namespace: 'per-suite',
        filesystem: 'temp-per-suite',
      },
    },
  ],
}

describe('classifyTestFile (scoped)', () => {
  it('classifies a src test file as unit', () => {
    const suites = classifyTestFile(minimalTaxonomy, 'src/core/backup.test.ts')
    expect(suites.map((s) => s.id)).toEqual(['unit'])
  })

  it('classifies a tests file as component', () => {
    const suites = classifyTestFile(minimalTaxonomy, 'tests/integration/storage.test.ts')
    expect(suites.map((s) => s.id)).toEqual(['component'])
  })

  it('returns empty array for a file matching no suite', () => {
    const suites = classifyTestFile(minimalTaxonomy, 'scripts/not-a-test.ts')
    expect(suites).toEqual([])
  })

  it('classifies a file to multiple suites when include patterns overlap', () => {
    const taxonomy: TestTaxonomy = {
      ...minimalTaxonomy,
      suites: [
        ...minimalTaxonomy.suites,
        {
          id: 'postgres',
          kind: 'contract',
          releaseRequired: true,
          include: ['tests/integration/storage.test.ts'],
          exclude: [],
          infrastructure: ['TEST_POSTGRES_URL'],
          onMissingInfrastructure: 'fail',
          fallbackPolicy: 'forbid',
          isolation: {
            process: 'per-file',
            port: 'dynamic',
            namespace: 'per-suite',
            filesystem: 'temp-per-suite',
          },
        },
      ],
    }
    const suites = classifyTestFile(taxonomy, 'tests/integration/storage.test.ts')
    expect(suites.map((s) => s.id).sort()).toEqual(['component', 'postgres'])
  })

  it('excludes from a suite when exclude pattern matches even if include matches', () => {
    const taxonomy: TestTaxonomy = {
      ...minimalTaxonomy,
      suites: [
        {
          ...minimalTaxonomy.suites[0]!,
          exclude: ['src/core/backup.test.ts'],
        },
        ...minimalTaxonomy.suites.slice(1),
      ],
    }
    const suites = classifyTestFile(taxonomy, 'src/core/backup.test.ts')
    expect(suites).toEqual([])
  })
})

describe('parseTestTaxonomy (scoped)', () => {
  it('rejects unknown isolation values', () => {
    const invalid = {
      schemaVersion: 1,
      testRunIdEnvironment: 'TEST_RUN_ID',
      suites: [
        {
          id: 'bad',
          kind: 'unit' as const,
          releaseRequired: false,
          include: ['tests/**/*.test.ts'],
          exclude: [],
          infrastructure: [],
          onMissingInfrastructure: 'skip' as const,
          fallbackPolicy: 'allow' as const,
          isolation: {
            process: 'unknown' as never,
            port: 'none' as const,
            namespace: 'none' as const,
            filesystem: 'none' as const,
          },
        },
      ],
    }
    expect(() => parseTestTaxonomy(invalid)).toThrow()
  })

  it('rejects release-required suites with skip on missing infra', () => {
    const invalid = {
      schemaVersion: 1,
      testRunIdEnvironment: 'TEST_RUN_ID',
      suites: [
        {
          id: 'bad',
          kind: 'contract' as const,
          releaseRequired: true,
          include: ['tests/**/*.test.ts'],
          exclude: [],
          infrastructure: ['TEST_POSTGRES_URL'],
          onMissingInfrastructure: 'skip' as const,
          fallbackPolicy: 'forbid' as const,
          isolation: {
            process: 'per-file' as const,
            port: 'dynamic' as const,
            namespace: 'per-suite' as const,
            filesystem: 'temp-per-suite' as const,
          },
        },
      ],
    }
    expect(() => parseTestTaxonomy(invalid)).toThrow('must fail')
  })
})
