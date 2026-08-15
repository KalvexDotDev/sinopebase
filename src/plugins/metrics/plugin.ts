// ---------------------------------------------------------------------------
// Metrics Plugin — Prometheus-compatible metrics + JSON API
// ---------------------------------------------------------------------------

import type { Elysia } from 'elysia'

export type MetricType = 'counter' | 'gauge'

/** Handle for a registered metric — mutate values through this. */
export interface MetricHandle {
  /** Add to the current value (default 1). */
  inc(amount?: number): void
  /** Replace the current value. */
  set(value: number): void
}

interface CustomMetric {
  type: MetricType
  help: string
  value: number
}

// Prometheus data-model metric names. Labels are not supported yet.
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/

export class MetricsPlugin {
  private startTime = Date.now()
  private requestCounts = { total: 0 }
  private statusCounts: Record<string, number> = {}
  private methodCounts: Record<string, number> = {}
  private latencies: number[] = []
  private custom = new Map<string, CustomMetric>()
  // Per-request start timestamps — ctx.store is app-wide state, so concurrent
  // requests would overwrite each other's start time.
  private requestStarts = new WeakMap<Request, number>()

  /**
   * Register a consumer metric published on /metrics (Prometheus) and
   * /api/metrics (JSON). Throws on invalid or duplicate names.
   *
   * CAUTION: both endpoints are unauthenticated (Prometheus scraping
   * convention). Never register secrets, tenant identifiers, or other
   * sensitive values. A private listener is the upgrade path if those
   * are needed.
   *
   * @example
   * ```ts
   * const sends = metrics.registerMetric('factory_sends', 'Factory sends', 'counter')
   * sends.inc() // per send
   * ```
   */
  registerMetric(name: string, help: string, type: MetricType): MetricHandle {
    if (!METRIC_NAME.test(name)) {
      throw new Error(`Invalid metric name "${name}" — must match ${METRIC_NAME}`)
    }
    if (name.startsWith('sinopebase_')) {
      throw new Error(`Metric "${name}" is reserved for built-in metrics`)
    }
    if (this.custom.has(name)) {
      throw new Error(`Metric "${name}" is already registered`)
    }
    const metric: CustomMetric = { type, help: help.replace(/[\r\n]+/g, ' '), value: 0 }
    this.custom.set(name, metric)
    return {
      inc: (amount = 1) => {
        metric.value += amount
      },
      set: (value) => {
        metric.value = value
      },
    }
  }

  async register(app: Elysia): Promise<Elysia> {
    // Collect metrics from every response
    app
      .onRequest((ctx) => {
        if (ctx.request) this.requestStarts.set(ctx.request, Date.now())
      })
      .onAfterHandle((ctx) => {
        // Scrapes of the metrics endpoints must not count themselves.
        const pathname = ctx.request?.url ? new URL(ctx.request.url).pathname : ''
        if (pathname === '/metrics' || pathname === '/api/metrics') return
        const start = ctx.request ? this.requestStarts.get(ctx.request) : undefined
        if (ctx.request) this.requestStarts.delete(ctx.request)
        const duration = Date.now() - (start || Date.now())
        const status = String(ctx.set?.status || 200)
        const method = ctx.request?.method || 'GET'

        this.requestCounts.total++
        this.statusCounts[status] = (this.statusCounts[status] || 0) + 1
        this.methodCounts[method] = (this.methodCounts[method] || 0) + 1
        this.latencies.push(duration)
        // Keep last 10k latencies
        if (this.latencies.length > 10_000) this.latencies.shift()
      })

    // JSON metrics endpoint
    app.get('/api/metrics', () => {
      const sorted = [...this.latencies].sort((a, b) => a - b)
      const avg =
        this.latencies.length > 0
          ? this.latencies.reduce((s, v) => s + v, 0) / this.latencies.length
          : 0
      // Lower-middle index so even-length windows do not report the max.
      const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] || 0
      const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] || 0
      const p99 = sorted[Math.floor((sorted.length - 1) * 0.99)] || 0
      const mem = process.memoryUsage?.() || { heapUsed: 0, heapTotal: 0, rss: 0 }

      return {
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime,
        requests: {
          total: this.requestCounts.total,
          byStatus: this.statusCounts,
          byMethod: this.methodCounts,
        },
        latency: { avg, p50, p95, p99 },
        memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
        custom: Object.fromEntries(this.custom),
      }
    })

    // Prometheus text format endpoint
    app.get('/metrics', ({ set }) => {
      set.headers['Content-Type'] = 'text/plain; version=0.0.4'
      const lines = [
        '# HELP sinopebase_uptime_seconds Server uptime',
        '# TYPE sinopebase_uptime_seconds gauge',
        `sinopebase_uptime_seconds ${(Date.now() - this.startTime) / 1000}`,
        '# HELP sinopebase_requests_total Total requests',
        '# TYPE sinopebase_requests_total counter',
        `sinopebase_requests_total ${this.requestCounts.total}`,
        '',
      ]
      for (const [status, count] of Object.entries(this.statusCounts)) {
        lines.push(
          `# HELP sinopebase_requests_by_status Requests by HTTP status`,
          `# TYPE sinopebase_requests_by_status counter`,
          `sinopebase_requests_by_status{status="${status}"} ${count}`,
          '',
        )
      }
      for (const [name, metric] of this.custom) {
        lines.push(
          `# HELP ${name} ${metric.help}`,
          `# TYPE ${name} ${metric.type}`,
          `${name} ${metric.value}`,
          '',
        )
      }
      return lines.join('\n')
    })

    console.log('Metrics: /api/metrics (JSON) + /metrics (Prometheus) ready')
    return app
  }
}
