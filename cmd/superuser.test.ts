import { describe, it, expect, beforeAll } from 'bun:test'
import { MemoryDatabase } from '~/core/db-memory.ts'

const SUPERUSERS_TABLE = '_superusers'

describe('cmd/superuser CRUD operations', () => {
  let db: MemoryDatabase

  beforeAll(() => {
    db = new MemoryDatabase()
    db.createTable(SUPERUSERS_TABLE)
  })

  it('creates a superuser record', async () => {
    const passwordHash = await Bun.password.hash('testpass123', {
      algorithm: 'bcrypt',
      cost: 4,
    })

    const result = db.insert(SUPERUSERS_TABLE, [
      {
        email: 'admin@test.com',
        passwordHash,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    ])

    expect(result[0]!['id']).toBeTruthy()
    expect(result[0]!['email']).toBe('admin@test.com')
  })

  it('lists superusers', () => {
    const result = db.select(SUPERUSERS_TABLE, {})
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.some((r) => r['email'] === 'admin@test.com')).toBe(true)
  })

  it('updates a superuser email', () => {
    const result = db.select(SUPERUSERS_TABLE, {
      filters: [{ column: 'email', operator: 'eq', value: 'admin@test.com' }],
    })
    expect(result.rows.length).toBe(1)
    const id = String(result.rows[0]!['id'])

    const updated = db.update(SUPERUSERS_TABLE, [{ column: 'id', operator: 'eq', value: id }], {
      email: 'updated@test.com',
      updated: new Date().toISOString(),
    })

    expect(updated[0]!['email']).toBe('updated@test.com')
  })

  it('deletes a superuser', () => {
    const result = db.select(SUPERUSERS_TABLE, {
      filters: [{ column: 'email', operator: 'eq', value: 'updated@test.com' }],
    })
    if (result.rows.length > 0) {
      const id = String(result.rows[0]!['id'])
      const deleted = db.delete(SUPERUSERS_TABLE, [{ column: 'id', operator: 'eq', value: id }])
      expect(deleted.length).toBe(1)

      const remaining = db.select(SUPERUSERS_TABLE, {
        filters: [{ column: 'id', operator: 'eq', value: id }],
      })
      expect(remaining.rows.length).toBe(0)
    }
  })
})
