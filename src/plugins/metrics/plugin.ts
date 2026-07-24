// ---------------------------------------------------------------------------
// Metrics Plugin — Prometheus-compatible metrics + JSON API
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'

const startTime = Date.now()
const requestCounts = { total: 0 }
const statusCounts: Record<string, number> = {}
const methodCounts: Record<string, number> = {}
const latencies: number[] = []

export class MetricsPlugin {
  async register(app: Elysia): Promise<void> {
    // Collect metrics from every response
    const startKey = '__metricsStart'

    app
      .onRequest((ctx: any) => {
        ctx.store[startKey] = Date.now()
      })
      .onAfterHandle((ctx: any) => {
        const duration = Date.now() - (ctx.store[startKey] || Date.now())
        const status = String(ctx.set?.status || 200)
        const method = ctx.request?.method || 'GET'

        requestCounts.total++
        statusCounts[status] = (statusCounts[status] || 0) + 1
        methodCounts[method] = (methodCounts[method] || 0) + 1
        latencies.push(duration)
        // Keep last 10k latencies
        if (latencies.length > 10_000) latencies.shift()
      })

    // JSON metrics endpoint
    app.get('/api/metrics', () => {
      const sorted = [...latencies].sort((a, b) => a - b)
      const avg = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0
      const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
      const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0
      const mem = process.memoryUsage?.() || { heapUsed: 0, heapTotal: 0, rss: 0 }

      return {
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        requests: { total: requestCounts.total, byStatus: statusCounts, byMethod: methodCounts },
        latency: { avg, p50, p95, p99 },
        memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
      }
    })

    // Prometheus text format endpoint
    app.get('/metrics', ({ set }) => {
      set.headers['Content-Type'] = 'text/plain; version=0.0.4'
      const lines = [
        '# HELP sinopebase_uptime_seconds Server uptime',
        '# TYPE sinopebase_uptime_seconds gauge',
        `sinopebase_uptime_seconds ${(Date.now() - startTime) / 1000}`,
        '# HELP sinopebase_requests_total Total requests',
        '# TYPE sinopebase_requests_total counter',
        `sinopebase_requests_total ${requestCounts.total}`,
        '',
      ]
      for (const [status, count] of Object.entries(statusCounts)) {
        lines.push(
          `# HELP sinopebase_requests_by_status Requests by HTTP status`,
          `# TYPE sinopebase_requests_by_status counter`,
          `sinopebase_requests_by_status{status="${status}"} ${count}`,
          '',
        )
      }
      return lines.join('\n')
    })

    console.log('Metrics: /api/metrics (JSON) + /metrics (Prometheus) ready')
  }
}
