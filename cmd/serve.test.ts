import { describe, it, expect } from 'bun:test'
import { Sinopebase } from '~/core/app.ts'

describe('cmd/serve argument parsing', () => {
  it('constructs Sinopebase with default config when no args provided', () => {
    const app = new Sinopebase({
      port: 8090,
      dataDir: './pb_data',
    })

    const config = app.getConfig()
    expect(config.port).toBe(8090)
    expect(config.dataDir).toBe('./pb_data')
  })

  it('constructs Sinopebase with custom port', () => {
    const app = new Sinopebase({ port: 9090 })
    const config = app.getConfig()
    expect(config.port).toBe(9090)
  })

  it('constructs Sinopebase with postgres URL', () => {
    const app = new Sinopebase({
      postgresUrl: 'postgres://localhost:5432/test',
    })
    const config = app.getConfig()
    expect(config.postgresUrl).toBe('postgres://localhost:5432/test')
  })

  it('constructs Sinopebase with JWT secret', () => {
    const app = new Sinopebase({ jwtSecret: 'my-secret' })
    const config = app.getConfig()
    expect(config.jwtSecret).toBe('my-secret')
  })

  it('merges config with defaults', () => {
    const app = new Sinopebase({ port: 3000 })
    const config = app.getConfig()
    expect(config.port).toBe(3000)
    expect(config.dataDir).toBe('./pb_data') // default
    expect(config.postgresUrl).toBe('') // default
  })
})
