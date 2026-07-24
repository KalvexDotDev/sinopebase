/**
 * Sinopebase Server Entry Point — Serve command.
 *
 * CLI entry point for starting the server.
 * Parses flags (port, host, dataDir, postgresUrl, TLS, dev mode).
 * Creates a Sinopebase instance and calls start().
 *
 * Run with: bun run cmd/serve.ts [options]
 *
 * Options:
 *   --port, -p <number>       Server port (default: 8090, env: PORT)
 *   --host <address>          Bind address (default: 0.0.0.0, env: HOST)
 *   --dataDir, -d <path>      Data directory (default: ./pb_data, env: DATA_DIR)
 *   --postgresUrl, --pg <url> PostgreSQL connection URL (env: POSTGRES_URL)
 *   --jwtSecret, --jwt <s>    JWT signing secret (env: JWT_SECRET)
 *   --tls-cert <path>         TLS certificate file path (env: TLS_CERT)
 *   --tls-key <path>          TLS private key file path (env: TLS_KEY)
 *   --dev, -D                 Enable development mode (env: DEV=true)
 *   --help, -h                Show this help message
 */

import { Sinopebase, type AppConfig } from '~/core/app.ts'

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

interface ServeFlags {
  port: number
  host: string
  dataDir: string
  postgresUrl: string
  jwtSecret: string
  tlsCert: string
  tlsKey: string
  dev: boolean
  help: boolean
}

/**
 * Parses command-line arguments into ServeFlags.
 */
function parseArgs(args: string[]): ServeFlags {
  const flags: ServeFlags = {
    port: parseInt(process.env['PORT'] ?? '8090', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
    dataDir: process.env['DATA_DIR'] ?? './pb_data',
    postgresUrl: process.env['POSTGRES_URL'] ?? '',
    jwtSecret: process.env['JWT_SECRET'] ?? '',
    tlsCert: process.env['TLS_CERT'] ?? '',
    tlsKey: process.env['TLS_KEY'] ?? '',
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
      case '--host': {
        const val = args[++i]
        if (val) flags.host = val
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
      case '--tls-cert': {
        const val = args[++i]
        if (val) flags.tlsCert = val
        break
      }
      case '--tls-key': {
        const val = args[++i]
        if (val) flags.tlsKey = val
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
  --host <address>          Bind address (default: 0.0.0.0, env: HOST)
  --dataDir, -d <path>      Data directory (default: ./pb_data, env: DATA_DIR)
  --postgresUrl, --pg <url> PostgreSQL connection URL (env: POSTGRES_URL)
  --jwtSecret, --jwt <s>    JWT signing secret (env: JWT_SECRET)
  --tls-cert <path>         TLS certificate file path (env: TLS_CERT)
  --tls-key <path>          TLS private key file path (env: TLS_KEY)
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

  const tls =
    flags.tlsCert && flags.tlsKey
      ? { cert: flags.tlsCert, key: flags.tlsKey }
      : undefined

  const server = new Sinopebase({
    port: flags.port,
    host: flags.host,
    dataDir: flags.dataDir,
    postgresUrl: flags.postgresUrl || undefined,
    jwtSecret: flags.jwtSecret || undefined,
    serviceRoleKey: process.env['SINOPEBASE_SERVICE_ROLE_KEY'] || undefined,
    anonKey: process.env['SINOPEBASE_ANON_KEY'] || undefined,
    tls,
    minioEndpoint: process.env['S3_ENDPOINT'] || undefined,
    minioAccessKey: process.env['S3_ACCESS_KEY'] || undefined,
    minioSecretKey: process.env['S3_SECRET_KEY'] || undefined,
    openaiApiKey: process.env['OPENAI_API_KEY'] || undefined,
    mastraRequireAuth: process.env['MASTRA_REQUIRE_AUTH'] !== 'false',
  } satisfies AppConfig)

  try {
    await server.start()
    if (flags.dev) {
      const protocol = flags.tlsCert && flags.tlsKey ? 'https' : 'http'
      console.log(`Dev server running on ${protocol}://127.0.0.1:${flags.port}`)
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
