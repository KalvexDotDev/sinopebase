import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Pool } from 'pg'
import { withPostgresMigrationLock } from '~/core/migration-lock'
import { requirePostgres } from '../harness'

describe('PostgreSQL migration advisory lock', () => {
  let first: Pool
  let second: Pool

  beforeAll(() => {
    const connectionString = requirePostgres()
    first = new Pool({ connectionString, max: 2 })
    second = new Pool({ connectionString, max: 2 })
  })

  afterAll(async () => {
    await Promise.all([first?.end(), second?.end()])
  })

  test('serializes migration work across independent pools', async () => {
    let active = 0
    let maxActive = 0
    const work = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await Bun.sleep(50)
      active--
    }
    await Promise.all([
      withPostgresMigrationLock(first, work),
      withPostgresMigrationLock(second, work),
    ])
    expect(maxActive).toBe(1)
  })
})
