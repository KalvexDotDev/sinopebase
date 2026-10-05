import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { DEFAULTS } from '~/plugins/drop-functions/config'
import { DropFunctionsPlugin } from '~/plugins/drop-functions/plugin'

// @new-code-test positive src/plugins/drop-functions/config.ts
// @new-code-test negative src/plugins/drop-functions/config.ts
// @new-code-test positive src/plugins/drop-functions/plugin.ts
// @new-code-test negative src/plugins/drop-functions/plugin.ts

describe('function management deployment mode', () => {
  test('single-instance default keeps management routes', async () => {
    const functionsDir = await mkdtemp(join(tmpdir(), 'sinope-functions-'))
    try {
      const app = new Elysia()
      const plugin = new DropFunctionsPlugin({ functionsDir })
      expect(DEFAULTS.manageEnabled).toBe(true)
      await plugin.register(app)
      const response = await app.handle(new Request('http://localhost/api/functions/v1'))
      expect(response.status).toBe(200)
      expect((await response.json()).count).toBe(0)
    } finally {
      await rm(functionsDir, { recursive: true, force: true })
    }
  })

  test('replicated mode removes management routes but still executes shared files', async () => {
    const functionsDir = await mkdtemp(join(tmpdir(), 'sinope-functions-'))
    try {
      await writeFile(join(functionsDir, 'hello.ts'), 'export default async () => ({ok: true})')
      const app = new Elysia()
      const plugin = new DropFunctionsPlugin({ functionsDir, manageEnabled: false })
      await plugin.register(app)
      const management = await app.handle(new Request('http://localhost/api/functions/v1'))
      expect(management.status).toBe(404)
      const execution = await app.handle(new Request('http://localhost/api/functions/v1/hello'))
      expect(execution.status).toBe(200)
      expect(await execution.json()).toMatchObject({ data: { ok: true }, functionName: 'hello' })
    } finally {
      await rm(functionsDir, { recursive: true, force: true })
    }
  })
})
