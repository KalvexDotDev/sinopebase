import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { hazardKey, scanTestHazards, type TestHazard } from './inventory'
import { moduleDirectory } from './portable-process'
import { classifyTestFile, loadTestTaxonomy } from './taxonomy'

interface TestInventory {
  schemaVersion: 1
  reviewedHazards: Array<Pick<TestHazard, 'kind' | 'file' | 'line'> & { disposition: string }>
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.claude',
  '.memento-staging',
  'dist',
  'node_modules',
  'pb_data',
])

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

async function discoverTests(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await discoverTests(root, absolute)))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(normalizePath(relative(root, absolute)))
    }
  }
  return files.sort()
}

export async function auditTestFoundation(root: string): Promise<{
  testCount: number
  unclassified: string[]
  multiplyClassified: Array<{ file: string; suites: string[] }>
  hazards: TestHazard[]
  unreviewedHazards: TestHazard[]
  staleReviewedHazards: string[]
}> {
  const taxonomy = await loadTestTaxonomy(join(root, 'wave0-test-taxonomy.json'))
  const inventory = JSON.parse(
    await Bun.file(join(root, 'wave0-test-inventory.json')).text(),
  ) as TestInventory
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.reviewedHazards)) {
    throw new Error('wave0-test-inventory.json has an unsupported shape')
  }

  const tests = await discoverTests(root)
  const unclassified: string[] = []
  const multiplyClassified: Array<{ file: string; suites: string[] }> = []
  for (const file of tests) {
    const suites = classifyTestFile(taxonomy, file).map((suite) => suite.id)
    if (suites.length === 0) unclassified.push(file)
    if (suites.length > 1) multiplyClassified.push({ file, suites })
  }

  const hazards = await scanTestHazards(root)
  const actualKeys = new Set(hazards.map(hazardKey))
  const reviewedKeys = new Set(inventory.reviewedHazards.map(hazardKey))

  return {
    testCount: tests.length,
    unclassified,
    multiplyClassified,
    hazards,
    unreviewedHazards: hazards.filter((hazard) => !reviewedKeys.has(hazardKey(hazard))),
    staleReviewedHazards: [...reviewedKeys].filter((key) => !actualKeys.has(key)).sort(),
  }
}

if (import.meta.main) {
  const root = resolve(moduleDirectory(import.meta.url), '../..')
  const result = await auditTestFoundation(root)
  const summary = {
    testCount: result.testCount,
    unclassified: result.unclassified,
    multiplyClassified: result.multiplyClassified,
    hazards: process.argv.includes('--list') ? result.hazards : result.hazards.length,
    unreviewedHazards: result.unreviewedHazards,
    staleReviewedHazards: result.staleReviewedHazards,
  }
  console.log(JSON.stringify(summary, null, 2))

  if (
    result.unclassified.length > 0 ||
    result.multiplyClassified.length > 0 ||
    result.unreviewedHazards.length > 0 ||
    result.staleReviewedHazards.length > 0
  ) {
    process.exitCode = 1
  }
}
