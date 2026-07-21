/**
 * Sinopebase Server Entry Point
 *
 * Starts the Sinopebase server on the configured port (default 8090).
 * Run with: bun run cmd/serve.ts
 */
import { Sinopebase } from '../src/core/app'

const port = parseInt(process.env.PORT ?? '8090', 10)
const dataDir = process.env.DATA_DIR ?? './pb_data'
const jwtSecret = process.env.JWT_SECRET ?? 'test-jwt-secret-for-development'

const server = new Sinopebase({
  port,
  dataDir,
  jwtSecret,
})

try {
  await server.start()
  console.log(`Sinopebase server started on http://127.0.0.1:${port}`)
} catch (err) {
  console.error('Failed to start Sinopebase server:', err)
  process.exit(1)
}
