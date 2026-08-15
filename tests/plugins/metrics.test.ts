/**
 * Metrics Plugin ATDD Tests
 *
 * Verifies registerMetric publishes consumer counters/gauges on both
 * /metrics (Prometheus text) and /api/metrics (JSON), and that invalid
 * names are rejected before they can corrupt the exposition format.
 */

import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { MetricsPlugin } from '~/plugins/metrics/plugin'

async function get(app: Elysia, path: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`))
}

interface MetricsJson {
  custom: Record<string, { type: string; help: string; value: number }>
}

describe('MetricsPlugin.registerMetric', () => {
  it('rejects invalid metric names', () => {
    const metrics = new MetricsPlugin()
    expect(() => metrics.registerMetric('bad name', 'x', 'counter')).toThrow()
    expect(() => metrics.registerMetric('9starts-with-digit', 'x', 'counter')).toThrow()
    expect(() => metrics.registerMetric('trailing-symbol-!', 'x', 'gauge')).toThrow()
  })

  it('rejects duplicate names', () => {
    const metrics = new MetricsPlugin()
    metrics.registerMetric('factory_sends', 'Sends', 'counter')
    expect(() => metrics.registerMetric('factory_sends', 'Sends again', 'counter')).toThrow()
  })

  it('rejects names reserved for built-in metrics', () => {
    const metrics = new MetricsPlugin()
    expect(() => metrics.registerMetric('sinopebase_requests_total', 'x', 'counter')).toThrow()
    expect(() => metrics.registerMetric('sinopebase_uptime_seconds', 'x', 'gauge')).toThrow()
  })

  it('publishes counters and gauges on /metrics and /api/metrics', async () => {
    const metrics = new MetricsPlugin()
    const app = await metrics.register(new Elysia())

    const sends = metrics.registerMetric('factory_sends', 'Factory sends', 'counter')
    const depth = metrics.registerMetric('queue_depth', 'Queue depth', 'gauge')
    sends.inc()
    sends.inc(4)
    depth.set(3)

    const prom = await (await get(app, '/metrics')).text()
    expect(prom).toContain('# TYPE factory_sends counter')
    expect(prom).toContain('factory_sends 5')
    expect(prom).toContain('# TYPE queue_depth gauge')
    expect(prom).toContain('queue_depth 3')

    const json = (await (await get(app, '/api/metrics')).json()) as MetricsJson
    expect(json.custom.factory_sends?.value).toBe(5)
    expect(json.custom.queue_depth?.type).toBe('gauge')
    expect(json.custom.queue_depth?.value).toBe(3)
  })

  it('sanitizes newlines in help text', async () => {
    const metrics = new MetricsPlugin()
    const app = await metrics.register(new Elysia())
    metrics.registerMetric('factory_cac', 'Cost\nper\nacquisition', 'gauge')

    const prom = await (await get(app, '/metrics')).text()
    expect(prom).toContain('# HELP factory_cac Cost per acquisition')
    expect(prom).not.toMatch(/Cost\n/)
  })

  it('does not count its own endpoint scrapes', async () => {
    const metrics = new MetricsPlugin()
    const app = await metrics.register(new Elysia())

    await get(app, '/metrics')
    await get(app, '/api/metrics')

    const json = (await (await get(app, '/api/metrics')).json()) as MetricsJson & {
      requests: { total: number }
    }
    expect(json.requests.total).toBe(0)
  })
})
