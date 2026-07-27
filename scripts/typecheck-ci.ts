/**
 * CI typecheck gate — fails only on NEW type errors.
 *
 * Compares current tsc errors against a committed baseline. If errors appear
 * that aren't in the baseline, exits non-zero. Pre-existing errors are
 * reported but don't block CI.
 *
 * Baseline: `typecheck-baseline.txt` (one error per line, format matches tsc output)
 */

const BASELINE_FILE = 'typecheck-baseline.txt'

async function run(): Promise<void> {
  // Run tsc and capture stderr
  const proc = Bun.spawn(['bun', 'run', 'typecheck'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited
  const output = stdout + stderr

  // Parse error lines: "file(line,col): error TS####: message"
  const currentErrors = new Set<string>()
  for (const line of output.split('\n')) {
    if (line.match(/error TS\d+:/)) {
      currentErrors.add(line.trim())
    }
  }

  // Load baseline
  let baselineErrors = new Set<string>()
  try {
    const baseline = await Bun.file(BASELINE_FILE).text()
    for (const line of baseline.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) baselineErrors.add(trimmed)
    }
  } catch {
    console.warn(`[typecheck-ci] No baseline found at ${BASELINE_FILE}. Creating one.`)
  }

  // Find new errors
  const newErrors = [...currentErrors].filter((e) => !baselineErrors.has(e))
  const fixedErrors = [...baselineErrors].filter((e) => !currentErrors.has(e))

  console.log(`[typecheck-ci] Total errors: ${currentErrors.size}`)
  console.log(`[typecheck-ci] Baseline errors: ${baselineErrors.size}`)
  console.log(`[typecheck-ci] Fixed since baseline: ${fixedErrors.length}`)
  console.log(`[typecheck-ci] New errors: ${newErrors.length}`)

  if (fixedErrors.length > 0) {
    console.log('\nErrors fixed since baseline:')
    for (const e of fixedErrors.slice(0, 10)) console.log(`  - ${e}`)
    if (fixedErrors.length > 10) console.log(`  ... and ${fixedErrors.length - 10} more`)
  }

  if (newErrors.length > 0) {
    console.log('\nNEW errors (must be fixed):')
    for (const e of newErrors.slice(0, 20)) console.log(`  ${e}`)
    if (newErrors.length > 20) console.log(`  ... and ${newErrors.length - 20} more`)
    process.exit(1)
  }

  console.log('[typecheck-ci] No new type errors — gate passed.')
  process.exit(0)
}

run()
