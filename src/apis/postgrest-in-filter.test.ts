import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { PostgresDatabase } from '../core/db-postgres'
import { mountPostgrestRoutes } from './postgrest'

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'

class UuidQueryDouble {
  private rows = [{ id: firstId }, { id: secondId }]

  selectAll(): this {
    return this
  }

  where(_column: string, operator: string, value: unknown): this {
    if (operator !== 'in' || !Array.isArray(value)) return this

    if (value.some((item) => String(item).startsWith('('))) {
      throw new Error(`invalid input syntax for type uuid: "${value[0]}"`)
    }

    this.rows = this.rows.filter((row) => value.includes(row.id))
    return this
  }

  async execute(): Promise<Record<string, unknown>[]> {
    return this.rows
  }
}

describe('PostgREST in filter', () => {
  it('passes each UUID as a separate PostgreSQL IN operand', async () => {
    const db = new PostgresDatabase({
      postgresUrl: 'postgres://unused:unused@127.0.0.1:1/unused',
    })
    ;(db as unknown as { reader: unknown }).reader = {
      selectFrom: () => new UuidQueryDouble(),
    }

    const app = new Elysia()
    mountPostgrestRoutes(app, db as never)

    const ids = encodeURIComponent(`(${firstId},${secondId})`)
    const response = await app.handle(
      new Request(`http://localhost/rest/v1/certification_controls?id=in.${ids}`),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: firstId }, { id: secondId }])
  })
})
