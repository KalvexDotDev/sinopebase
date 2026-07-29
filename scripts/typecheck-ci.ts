const BASELINE = 'typecheck-baseline.txt'

async function run() {
  const proc = Bun.spawn(['bun', 'run', 'typecheck'], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  await proc.exited

  const current = new Set<string>()
  for (const line of (out + err).split('\n')) {
    if (line.match(/error TS\d+:/)) current.add(line.trim())
  }

  const base = new Set<string>()
  try {
    for (const line of (await Bun.file(BASELINE).text()).split('\n')) {
      if (line.trim()) base.add(line.trim())
    }
  } catch {
    /* no baseline yet */
  }

  const added = [...current].filter((e) => !base.has(e))
  const removed = [...base].filter((e) => !current.has(e))

  console.log(
    `[typecheck-ci] current:${current.size} baseline:${base.size} fixed:${removed.length} new:${added.length}`,
  )

  if (added.length > 0) {
    console.log('NEW errors:')
    for (const e of added.slice(0, 20)) console.log(`  ${e}`)
    if (added.length > 20) console.log(`  ...+${added.length - 20}`)
    process.exit(1)
  }

  if (removed.length > 0) {
    console.log(
      `Errors fixed: ${removed
        .slice(0, 5)
        .map((e) => e.slice(0, 80))
        .join(', ')}${removed.length > 5 ? ` ...+${removed.length - 5}` : ''}`,
    )
  }
  console.log('[typecheck-ci] gate passed')
}

run()
