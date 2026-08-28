import { mkdirSync, writeFileSync } from 'node:fs'
import { discoverNewCode, findTestClaims, lineRanges } from './new-code'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function main(): Promise<void> {
  const change = discoverNewCode()
  const mutate = lineRanges(change.sourceLines)
  if (mutate.length === 0) {
    console.log(`[mutation] no changed production code relative to ${change.base}; gate skipped`)
    return
  }
  const testFiles = findTestClaims(change.sourceLines, change.testFiles).testFiles
  if (testFiles.length === 0) throw new Error('Mutation testing requires claimed changed test files')

  mkdirSync('coverage/new-code', { recursive: true })
  const configFile = 'coverage/new-code/stryker.config.json'
  writeFileSync(
    configFile,
    JSON.stringify(
      {
        $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
        mutate,
        testRunner: 'command',
        commandRunner: {
          command: `bun test ${testFiles.map(shellQuote).join(' ')}`,
        },
        // TypeScript 7's package root intentionally exposes only version data;
        // pointing Stryker's path rewriter at a non-project file avoids its
        // legacy compiler-API import. Bun still reads the real tsconfig.json.
        tsconfigFile: '.stryker-no-tsconfig.json',
        coverageAnalysis: 'off',
        concurrency: 1,
        timeoutMS: 60_000,
        reporters: ['clear-text', 'json', 'html'],
        jsonReporter: { fileName: 'coverage/new-code/mutation.json' },
        htmlReporter: { fileName: 'coverage/new-code/mutation.html' },
        thresholds: { high: 100, low: 100, break: 100 },
        cleanTempDir: true,
      },
      null,
      2,
    ),
  )
  console.log(`[mutation] mutating ${mutate.join(', ')}`)
  const process = Bun.spawn(['bunx', 'stryker', 'run', configFile], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: Bun.env,
  })
  if ((await process.exited) !== 0) throw new Error('New-code mutation gate failed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
