import { createServer, type Server } from 'node:net'

export const TEST_LOOPBACK_HOST = '127.0.0.1' as const

export interface TestPortReservation {
  readonly host: typeof TEST_LOOPBACK_HOST
  readonly port: number
  readonly origin: string
  readonly released: boolean
  release(): Promise<void>
}

class LoopbackPortReservation implements TestPortReservation {
  readonly host = TEST_LOOPBACK_HOST
  readonly origin: string
  readonly port: number
  private readonly server: Server
  #released = false

  constructor(port: number, server: Server) {
    this.port = port
    this.server = server
    this.origin = `http://${this.host}:${port}`
  }

  get released(): boolean {
    return this.#released
  }

  async release(): Promise<void> {
    if (this.#released) return
    this.#released = true

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

/** First stack frame outside this file and the harness directory. */
function callerFile(): string {
  const frames = (new Error().stack ?? '').split('\n').slice(2)
  for (const frame of frames) {
    const match = /\(([^)]+)\)/.exec(frame)?.[1] ?? frame.trim().split(' ')[0]
    if (!match) continue
    const path = match.split(':')[0] ?? match
    if (path && !path.includes('tests/harness') && !path.includes('ports.ts')) return path
  }
  return ''
}

/** Deterministic 25000-port range per test file so parallel workers can never collide. */
function preferredPort(): number {
  const file = callerFile()
  // FNV-1a over the full path — collisions across ~40 test files are
  // practically impossible in a 25k bucket range.
  let hash = 0x811c9dc5
  for (const char of file) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return 30_000 + ((hash >>> 0) % 25_000)
}

/**
 * Ask the OS for an unused loopback port and hold it until the caller is ready
 * to start its server. The port is picked from a per-file deterministic range
 * so the release-to-bind window cannot hand the same port to another test
 * file running in a parallel worker.
 */
export async function reserveLoopbackPort(): Promise<TestPortReservation> {
  let lastError: Error | null = null

  // Try the preferred port first, then nearby ports in the file's range.
  const base = preferredPort()
  for (let offset = 0; offset < 20; offset++) {
    const candidate = base + offset * 7
    if (candidate > 40_000) break
    const server = createServer()
    server.unref()

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        server.once('error', onError)
        server.listen({ host: TEST_LOOPBACK_HOST, port: candidate, exclusive: true }, () => {
          server.off('error', onError)
          resolve()
        })
      })
      return new LoopbackPortReservation(candidate, server)
    } catch (error) {
      lastError = error as Error
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // Port taken — try the next candidate in the range.
    }
  }

  // Fall back to an OS-assigned ephemeral port.
  const server = createServer()
  server.unref()
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen({ host: TEST_LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('The OS did not assign a numeric loopback test port')
  }
  if (lastError) console.warn('[harness] preferred port range exhausted', lastError.message)
  return new LoopbackPortReservation(address.port, server)
}
