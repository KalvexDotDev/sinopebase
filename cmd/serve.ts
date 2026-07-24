/**
 * Sinopebase Server Entry Point — Serve command.
 *
 * CLI entry point for starting the server.
 * Parses flags (port, dataDir, postgresUrl, dev mode).
 * Creates a Sinopebase instance and calls start().
 *
 * Run with: bun run cmd/serve.ts [options]
 *
 * Options:
 *   --port <number>       Server port (default: 8090, env: PORT)
 *   --dataDir <path>      Data directory (default: ./pb_data, env: DATA_DIR)
 *   --postgresUrl <url>   PostgreSQL connection URL (env: POSTGRES_URL)
 *   --dev                 Enable development mode (env: DEV=true)
 *   --jwtSecret <secret>  JWT signing secret (env: JWT_SECRET)
 *   --help                Show this help message
 */

import { Sinopebase } from '~/core/app.ts'

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

interface ServeFlags {
  port: number
  dataDir: string
  postgresUrl: string
  jwtSecret: string
  dev: boolean
  help: boolean
}

/**
 * Parses command-line arguments into ServeFlags.
 */
function parseArgs(args: string[]): ServeFlags {
  const flags: ServeFlags = {
    port: parseInt(process.env['PORT'] ?? '8090', 10),
    dataDir: process.env['DATA_DIR'] ?? './pb_data',
    postgresUrl: process.env['POSTGRES_URL'] ?? '',
    jwtSecret: process.env['JWT_SECRET'] ?? '',
    dev: process.env['DEV'] === 'true',
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!

    switch (arg) {
      case '--port':
      case '-p': {
        const val = args[++i]
        if (val) flags.port = parseInt(val, 10)
        break
      }
      case '--dataDir':
      case '-d': {
        const val = args[++i]
        if (val) flags.dataDir = val
        break
      }
      case '--postgresUrl':
      case '--pg': {
        const val = args[++i]
        if (val) flags.postgresUrl = val
        break
      }
      case '--jwtSecret':
      case '--jwt': {
        const val = args[++i]
        if (val) flags.jwtSecret = val
        break
      }
      case '--dev':
      case '-D':
        flags.dev = true
        break
      case '--help':
      case '-h':
        flags.help = true
        break
    }
  }

  return flags
}

/**
 * Prints the help message.
 */
function printHelp(): void {
  console.log(`
Sinopebase Server — CLI entry point

USAGE
  bun run cmd/serve.ts [options]

OPTIONS
  --port, -p <number>       Server port (default: 8090, env: PORT)
  --dataDir, -d <path>      Data directory (default: ./pb_data, env: DATA_DIR)
  --postgresUrl, --pg <url> PostgreSQL connection URL (env: POSTGRES_URL)
  --jwtSecret, --jwt <s>    JWT signing secret (env: JWT_SECRET)
  --dev, -D                 Enable development mode (env: DEV=true)
  --help, -h                Show this help message
`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseArgs(Bun.argv.slice(2))

  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  if (flags.dev) {
    console.log('DEV mode enabled')
  }

  const server = new Sinopebase({
    port: flags.port,
    dataDir: flags.dataDir,
    postgresUrl: flags.postgresUrl || undefined,
    jwtSecret: flags.jwtSecret || undefined,
  })

  try {
    await server.start()
    if (flags.dev) {
      console.log(`Dev server running on http://127.0.0.1:${flags.port}`)
    }
  } catch (err) {
    console.error('Failed to start Sinopebase server:', err)
    process.exit(1)
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...')
    await server.stop()
    process.exit(0)
  })
}

await main()
