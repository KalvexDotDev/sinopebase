import { readdirSync } from 'fs'
import { resolve } from 'path'
import { spawnSync } from 'child_process'

const EXT_RE = /\.(js|mjs|cjs)$/
const SKIP = new Set(['node_modules', 'dist', 'ui', '.claude', '.git'])

function findJs(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    let entries
    try {
      entries = readdirSync(stack.pop()!, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = resolve(e.parentPath ?? dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(p)
      } else if (EXT_RE.test(e.name)) out.push(p)
    }
  }
  return out
}

const files = [...findJs(resolve('src')), ...findJs(resolve('tests'))]
if (!files.length) {
  console.log('[eslint] No JS files — skipping')
  process.exit(0)
}
console.log(`[eslint] ${files.length} file(s)`)
process.exit(
  spawnSync('npx', ['eslint', ...process.argv.slice(2), ...files], {
    stdio: 'inherit',
    cwd: process.cwd(),
  }).status ?? 1,
)
