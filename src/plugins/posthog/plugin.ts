import type { Elysia } from 'elysia'
import { z } from 'zod'

function hasExtraUrlComponents(url: URL): boolean {
  return [url.username, url.password, url.search, url.hash].some(Boolean) || url.pathname !== '/'
}

const settings = z.object({
  host: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value)
      return (
        url.protocol === 'https:' &&
        !hasExtraUrlComponents(url) &&
        (url.hostname.endsWith('.internal') || url.hostname.endsWith('.ts.net'))
      )
    }),
  token: z.string().trim().min(1),
})
export type PosthogOptions = z.infer<typeof settings>

export function posthogOptionsFromEnv(
  env: Record<string, string | undefined>,
): PosthogOptions | undefined {
  if (env.POSTHOG_ENABLED !== 'true') return undefined
  const result = settings.safeParse({ host: env.POSTHOG_HOST, token: env.POSTHOG_API_KEY })
  if (!result.success) throw new Error('PostHog requires a private HTTPS origin and project token')
  return result.data
}

function responseStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500
}

type Observation = {
  uuid: string
  event: 'sinopebase_request_completed' | '$exception'
  timestamp: string
  properties: {
    distinct_id: string
    $process_person_profile: false
    $ip: null
    route: string
    method: string
    status: number
    duration_ms: number
    $exception_list?: {
      type: 'Error'
      value: string
      mechanism: { handled: false; synthetic: true }
    }[]
    $exception_fingerprint?: string
  }
}

/** Operational telemetry only. Never accepts raw errors, bodies, headers,
 * query strings, user IDs or tenant IDs. No route creates a public metrics API.
 */
export class PosthogPlugin {
  private readonly options: PosthogOptions | undefined
  private readonly processId = crypto.randomUUID()
  private readonly starts = new WeakMap<Request, number>()
  private readonly queue: Observation[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private pending: Promise<void> | undefined
  private closed = false
  private dropped = 0

  private readonly send: typeof fetch

  constructor(options?: PosthogOptions, send: typeof fetch = fetch) {
    this.send = send
    const result = options === undefined ? undefined : settings.safeParse(options)
    if (result && !result.success) throw new Error('Invalid private PostHog configuration')
    this.options = result?.data
  }

  get droppedEvents(): number {
    return this.dropped
  }

  register(app: Elysia): Elysia {
    if (!this.options) return app
    app
      .onRequest(({ request }) => {
        this.starts.set(request, performance.now())
      })
      .onAfterResponse({ as: 'global' }, ({ request, route, set, responseValue }) => {
        this.observe(
          request,
          route,
          responseValue instanceof Response ? responseValue.status : Number(set.status ?? 200),
        )
      })
      .onStart(() => {
        this.closed = false
        this.timer = setInterval(() => {
          void this.flush()
        }, 5000).unref()
      })
      .onStop(() => this.shutdown())
    return app
  }

  private enqueue(event: Observation): boolean {
    if (this.queue.length >= 1000) {
      this.dropped++
      return false
    }
    this.queue.push(event)
    return true
  }

  private observation(request: Request, route: unknown, status: number): Observation {
    const start = this.starts.get(request)
    this.starts.delete(request)
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(
      request.method,
    )
      ? request.method
      : 'OTHER'
    return {
      uuid: crypto.randomUUID(),
      event: 'sinopebase_request_completed',
      timestamp: new Date().toISOString(),
      properties: {
        distinct_id: `sinopebase:${this.processId}`,
        $process_person_profile: false,
        $ip: null,
        // Registered route template only; never request URL or parameters.
        route: typeof route === 'string' ? route : '(unmatched)',
        method,
        status: responseStatus(status),
        duration_ms: Math.max(0, Math.round(performance.now() - (start ?? performance.now()))),
      },
    }
  }

  private observe(request: Request, route: unknown, status: number): void {
    if (this.closed) return
    const observation = this.observation(request, route, status)
    if (!this.enqueue(observation)) return
    if (observation.properties.status >= 500) this.enqueue(this.exception(observation))
  }

  private exception(observation: Observation): Observation {
    // Group failed responses without inspecting raw exceptions or identities.
    return {
      ...observation,
      uuid: crypto.randomUUID(),
      event: '$exception',
      properties: {
        ...observation.properties,
        $exception_list: [
          {
            type: 'Error',
            value: 'Unexpected backend error (details withheld)',
            mechanism: { handled: false, synthetic: true },
          },
        ],
        $exception_fingerprint: JSON.stringify([
          'sinopebase',
          observation.properties.route,
          observation.properties.method,
          observation.properties.status,
        ]),
      },
    }
  }

  flush(): Promise<void> {
    if (this.pending) return this.pending
    if (!this.options || this.queue.length === 0) return Promise.resolve()
    const options = this.options
    // The whole queue is bounded; one batch/timeout also bounds shutdown time.
    const batch = this.queue.splice(0)
    this.pending = (async () => {
      try {
        const response = await this.send(`${new URL(options.host).origin}/batch/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ api_key: options.token, batch }),
        })
        if (!response.ok) this.dropped += batch.length
        await response.body?.cancel()
      } catch {
        // Telemetry failure never changes a response or logs payload/credentials.
        this.dropped += batch.length
      } finally {
        this.pending = undefined
      }
    })()
    return this.pending
  }

  async shutdown(): Promise<void> {
    // Elysia schedules after-response hooks with setImmediate. Drain those
    // already scheduled before closing collection and flushing the last batch.
    await new Promise<void>((resolve) => setImmediate(resolve))
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (this.pending) await this.pending
    await this.flush()
  }
}
