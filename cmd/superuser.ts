/**
 * Superuser management CLI — create, update, delete superuser accounts.
 *
 * Port of PocketBase's cmd/superuser.go (Go -> TypeScript).
 * Layer 5 -- imports from ~/core/*.
 *
 * Run with: bun run cmd/superuser.ts <command> [options]
 *
 * Commands:
 *   create <email> <password>   Create a new superuser
 *   update <id> <email>         Update superuser email
 *   delete <id>                 Delete a superuser
 *   list                        List all superusers
 *   --help                      Show this help message
 *
 * Environment variables:
 *   POSTGRES_URL   PostgreSQL connection URL (required for persistent storage)
 *   DATA_DIR       Data directory for local storage
 */

import { Sinopebase } from '~/core/app.ts'
import type { IDatabase } from '~/core/db-interface.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPERUSERS_TABLE = '_superusers'

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

interface SuperuserFlags {
  command: string
  args: string[]
  help: boolean
}

function parseArgs(args: string[]): SuperuserFlags {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { command: '', args: [], help: true }
  }

  return {
    command: args[0]!,
    args: args.slice(1),
    help: false,
  }
}

function printHelp(): void {
  console.log(`
Superuser Management CLI

USAGE
  bun run cmd/superuser.ts <command> [options]

COMMANDS
  create <email> <password>   Create a new superuser
  update <id> <email>         Update superuser email
  delete <id>                 Delete a superuser
  list                        List all superusers
  --help, -h                  Show this help message

EXAMPLES
  bun run cmd/superuser.ts create admin@example.com 1234567890
  bun run cmd/superuser.ts list
  bun run cmd/superuser.ts update abc123 admin@example.com
  bun run cmd/superuser.ts delete abc123
`)
}

// ---------------------------------------------------------------------------
// Superuser CRUD helpers
// ---------------------------------------------------------------------------

interface SuperuserRecord {
  id: string
  email: string
  created?: string
  updated?: string
}

async function ensureSuperusersTable(db: IDatabase): Promise<void> {
  if (!(await db.hasTable(SUPERUSERS_TABLE))) {
    await db.createTable(SUPERUSERS_TABLE)
  }
}

async function listSuperusers(db: IDatabase): Promise<SuperuserRecord[]> {
  await ensureSuperusersTable(db)
  const rows = await db.select(SUPERUSERS_TABLE, { filters: [] })
  return rows.map((r) => ({
    id: String(r.id ?? ''),
    email: String(r.email ?? ''),
    created: r.created ? String(r.created) : undefined,
    updated: r.updated ? String(r.updated) : undefined,
  }))
}

async function createSuperuserRecord(
  db: IDatabase,
  email: string,
  password: string,
): Promise<SuperuserRecord> {
  await ensureSuperusersTable(db)
  const passwordHash = await Bun.password.hash(password, {
    algorithm: 'bcrypt',
    cost: 10,
  })
  const now = new Date().toISOString()
  const record = await db.insert(SUPERUSERS_TABLE, {
    email,
    passwordHash,
    created: now,
    updated: now,
  })
  return {
    id: String(record.id),
    email: String(record.email),
    created: String(record.created),
    updated: String(record.updated),
  }
}

async function updateSuperuserRecord(
  db: IDatabase,
  id: string,
  email: string,
): Promise<void> {
  await ensureSuperusersTable(db)
  await db.update(
    SUPERUSERS_TABLE,
    [{ column: 'id', operator: 'eq', value: id }],
    { email, updated: new Date().toISOString() },
  )
}

async function deleteSuperuserRecord(
  db: IDatabase,
  id: string,
): Promise<void> {
  await ensureSuperusersTable(db)
  await db.delete(SUPERUSERS_TABLE, [
    { column: 'id', operator: 'eq', value: id },
  ])
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

  const app = new Sinopebase({
    postgresUrl: process.env.POSTGRES_URL || undefined,
    dataDir: process.env.DATA_DIR || './pb_data',
  })

  try {
    // Bootstrap the app to initialize database
    await app.start()
    const db = app.getDatabase()
    if (!db) {
      console.error('Database not available')
      process.exit(1)
    }

    switch (flags.command) {
      case 'create': {
        if (flags.args.length < 2) {
          console.error('Usage: superuser create <email> <password>')
          process.exit(1)
        }
        const email = flags.args[0]!
        const password = flags.args[1]!
        const su = await createSuperuserRecord(db, email, password)
        console.log(`Superuser created: ${su.id} (${email})`)
        break
      }

      case 'update': {
        if (flags.args.length < 2) {
          console.error('Usage: superuser update <id> <email>')
          process.exit(1)
        }
        const id = flags.args[0]!
        const email = flags.args[1]!
        await updateSuperuserRecord(db, id, email)
        console.log(`Superuser ${id} updated: ${email}`)
        break
      }

      case 'delete': {
        if (flags.args.length < 1) {
          console.error('Usage: superuser delete <id>')
          process.exit(1)
        }
        const id = flags.args[0]!
        await deleteSuperuserRecord(db, id)
        console.log(`Superuser ${id} deleted`)
        break
      }

      case 'list': {
        const superusers = await listSuperusers(db)
        if (superusers.length === 0) {
          console.log('No superusers found.')
        } else {
          console.log('Superusers:')
          for (const su of superusers) {
            console.log(`  ${su.id}  ${su.email}`)
          }
        }
        break
      }

      default: {
        console.error(`Unknown command: ${flags.command}`)
        printHelp()
        process.exit(1)
      }
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    await app.stop()
  }
}

await main()
