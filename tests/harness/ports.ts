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

/**
 * Ask the OS for an unused loopback port and hold it until the caller is ready
 * to start its server. Reservations obtained in parallel cannot collide.
 *
 * Release immediately before binding the real server, and keep the reservation
 * object until teardown so tests can assert that setup released it. The small
 * release-to-bind race cannot be removed without the server accepting an
 * already-bound socket, but this avoids deterministic fixed-port collisions.
 */
export async function reserveLoopbackPort(): Promise<TestPortReservation> {
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

  return new LoopbackPortReservation(address.port, server)
}
