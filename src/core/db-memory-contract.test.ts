// @new-code-test positive src/core/db-memory.ts
// @new-code-test negative src/core/db-memory.ts
// @new-code-test positive src/core/db-memory-adapter.ts
// @new-code-test negative src/core/db-memory-adapter.ts
import { describe, expect, it } from 'bun:test'
import type { Filter, IDatabase } from './db-interface'
import { hasDatabaseSchemaCapability } from './db-interface'
import { MemoryDatabaseAdapter } from './db-memory-adapter'

describe('MemoryDatabaseAdapter canonical database contract', () => {
  it('provides async single-record CRUD through IDatabase', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('records')

    const inserted = await db.insert('records', {
      id: 'one',
      tenant: 'a',
      state: 'open',
      rank: 1,
      enabled: true,
    })
    expect(inserted.id).toBe('one')

    const upserted = await db.upsert('records', {
      id: 'one',
      tenant: 'a',
      state: 'closed',
      rank: 2,
      enabled: false,
    })
    expect(upserted?.state).toBe('closed')
    expect(await db.count('records')).toBe(1)

    const updated = await db.update('records', [{ column: 'id', operator: 'eq', value: 'one' }], {
      state: 'open',
    })
    expect(updated[0]?.state).toBe('open')

    const deleted = await db.delete('records', [{ column: 'id', operator: 'eq', value: 'one' }])
    expect(deleted.map((row) => row.id)).toEqual(['one'])
    expect(await db.count('records')).toBe(0)
  })

  it('supports optional filters, structured OR groups, ordering, and pagination', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('records')
    await db.insert('records', { id: 'a', tenant: 'one', state: 'open', rank: 1 })
    await db.insert('records', { id: 'b', tenant: 'one', state: 'closed', rank: 2 })
    await db.insert('records', { id: 'c', tenant: 'two', state: 'open', rank: 3 })

    const selected = await db.select('records', {
      filters: [{ column: 'tenant', operator: 'eq', value: 'one' }],
      orFilters: [
        [{ column: 'state', operator: 'eq', value: 'open' }],
        [{ column: 'rank', operator: 'eq', value: 2 }],
      ],
      order: [{ column: 'rank', direction: 'desc' }],
      limit: 1,
      offset: 0,
    })

    expect(selected.map((row) => row.id)).toEqual(['b'])
    expect(await db.select('records', {})).toHaveLength(3)
  })

  it('matches match/imatch filters as unanchored POSIX regexes and rejects invalid patterns', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('versions')
    await db.insert('versions', { id: 'a', version: '3' })
    await db.insert('versions', { id: 'b', version: '10' })
    await db.insert('versions', { id: 'c', version: 'V3' })
    await db.insert('versions', { id: 'd', version: null })

    const ids = async (filters: Filter[]): Promise<unknown[]> =>
      (await db.select('versions', { filters })).map((row) => row.id)

    // Anchored pattern: only the numeric versions match.
    expect(
      await ids([{ column: 'version', operator: 'match', value: '^[1-9][0-9]{0,8}$' }]),
    ).toEqual(['a', 'b'])
    // Unanchored and case-sensitive, like PostgreSQL `~`.
    expect(await ids([{ column: 'version', operator: 'match', value: 'V' }])).toEqual(['c'])
    // Case-insensitive, like PostgreSQL `~*`.
    expect(await ids([{ column: 'version', operator: 'imatch', value: '^v3$' }])).toEqual(['c'])
    // Null values never match.
    expect(await ids([{ column: 'version', operator: 'match', value: '.' }])).toEqual([
      'a',
      'b',
      'c',
    ])
    // Invalid patterns throw, as the SQL `~` operator errors, instead of not matching.
    await expect(
      db.select('versions', { filters: [{ column: 'version', operator: 'match', value: '[' }] }),
    ).rejects.toThrow('Invalid regular expression in match filter')
  })

  it('matches every operator in memory mode, including negate and the throwing cases', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('ops')
    await db.insert('ops', {
      id: 'a',
      version: '3',
      label: 'Alpha',
      flag: false,
      empty: null,
      rank: 2,
      tags: ['x', 'y'],
      meta: { role: 'admin', active: true },
      scalar: 'plain',
    })
    await db.insert('ops', {
      id: 'b',
      version: '10',
      label: 'alpha',
      flag: true,
      empty: null,
      rank: 11,
      tags: ['y'],
      meta: { role: 'user' },
      scalar: '3',
    })
    await db.insert('ops', {
      id: 'c',
      version: 'V3',
      label: 'Beta',
      flag: true,
      empty: 'present',
      rank: 3,
      tags: ['z'],
      meta: { role: 'admin' },
      scalar: 'plain',
    })

    const ids = async (filters: Filter[]): Promise<unknown[]> =>
      (await db.select('ops', { filters })).map((row) => row.id)

    // eq / neq (null-safe) / gt / gte / lt / lte
    expect(await ids([{ column: 'version', operator: 'eq', value: '3' }])).toEqual(['a'])
    expect(await ids([{ column: 'version', operator: 'neq', value: '3' }])).toEqual(['b', 'c'])
    expect(await ids([{ column: 'empty', operator: 'neq', value: 'null' }])).toEqual(['c'])
    expect(await ids([{ column: 'rank', operator: 'gt', value: 3 }])).toEqual(['b'])
    expect(await ids([{ column: 'rank', operator: 'gte', value: 3 }])).toEqual(['b', 'c'])
    expect(await ids([{ column: 'rank', operator: 'lt', value: 3 }])).toEqual(['a'])
    expect(await ids([{ column: 'rank', operator: 'lte', value: 3 }])).toEqual(['a', 'c'])
    // A missing value orders below everything; non-numeric values compare as strings.
    expect(await ids([{ column: 'missing', operator: 'gt', value: 0 }])).toEqual([])
    expect(await ids([{ column: 'label', operator: 'gt', value: 'B' }])).toEqual(['c'])
    // like / ilike
    expect(await ids([{ column: 'version', operator: 'like', value: '1%' }])).toEqual(['b'])
    expect(await ids([{ column: 'version', operator: 'ilike', value: 'v%' }])).toEqual(['c'])
    // match / imatch
    expect(await ids([{ column: 'version', operator: 'match', value: '^[0-9]+$' }])).toEqual([
      'a',
      'b',
    ])
    expect(await ids([{ column: 'version', operator: 'imatch', value: '^v3$' }])).toEqual(['c'])
    // is: null, booleans, and value equality
    expect(await ids([{ column: 'empty', operator: 'is', value: null }])).toEqual(['a', 'b'])
    expect(await ids([{ column: 'flag', operator: 'is', value: false }])).toEqual(['a'])
    expect(await ids([{ column: 'flag', operator: 'is', value: 'true' }])).toEqual(['b', 'c'])
    expect(await ids([{ column: 'rank', operator: 'is', value: 2 }])).toEqual(['a'])
    // in
    expect(await ids([{ column: 'version', operator: 'in', value: [3, 10] }])).toEqual(['a', 'b'])
    // cs / cd: array, object, and scalar containment on both sides
    expect(await ids([{ column: 'tags', operator: 'cs', value: ['y'] }])).toEqual(['a', 'b'])
    expect(await ids([{ column: 'tags', operator: 'cs', value: 'z' }])).toEqual(['c'])
    expect(await ids([{ column: 'meta', operator: 'cs', value: { role: 'admin' } }])).toEqual([
      'a',
      'c',
    ])
    expect(await ids([{ column: 'tags', operator: 'cd', value: ['x', 'y'] }])).toEqual(['a', 'b'])
    expect(
      await ids([{ column: 'meta', operator: 'cd', value: { role: 'admin', active: true } }]),
    ).toEqual(['a', 'c'])
    expect(await ids([{ column: 'scalar', operator: 'cs', value: 'plain' }])).toEqual(['a', 'c'])
    // Containment against a missing row value, a non-array container, and a non-object container.
    expect(await ids([{ column: 'missing', operator: 'cs', value: { role: 'admin' } }])).toEqual([])
    expect(await ids([{ column: 'scalar', operator: 'cs', value: ['plain'] }])).toEqual([])
    expect(await ids([{ column: 'scalar', operator: 'cs', value: { role: 'admin' } }])).toEqual([])
    // negate flips the predicate
    expect(await ids([{ column: 'version', operator: 'eq', value: '3', negate: true }])).toEqual([
      'b',
      'c',
    ])

    // Unsupported operators and full-text search reject instead of silently not matching.
    await expect(
      db.select('ops', { filters: [{ column: 'version', operator: 'bogus', value: '3' }] }),
    ).rejects.toThrow('Unsupported filter operator: bogus')
    for (const operator of ['fts', 'plfts', 'phfts', 'wfts']) {
      await expect(
        db.select('ops', { filters: [{ column: 'version', operator, value: 'three' }] }),
      ).rejects.toThrow('Full-text search is not supported in memory mode')
    }
  })

  it('distinguishes case sensitivity, is-value spelling, and in-value shapes', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('edges')
    await db.insert('edges', {
      id: 'e1',
      label: 'Alpha',
      flag: true,
      empty: null,
      spelled: 'null',
      combo: 'a,b',
    })
    await db.insert('edges', {
      id: 'e2',
      label: 'alpha',
      flag: 'true',
      empty: 'x',
      spelled: 'present',
      combo: 'ab',
    })
    await db.insert('edges', { id: 'e3', label: 'ALPHA', flag: 'false', spelled: 'x', combo: 'a' })

    const ids = async (filters: Filter[]): Promise<unknown[]> =>
      (await db.select('edges', { filters })).map((row) => row.id)

    // match is case-sensitive, imatch is not; both are unanchored.
    expect(await ids([{ column: 'label', operator: 'match', value: '^alpha$' }])).toEqual(['e2'])
    expect(await ids([{ column: 'label', operator: 'imatch', value: '^ALPHA$' }])).toEqual([
      'e1',
      'e2',
      'e3',
    ])
    // like is case-sensitive, ilike is not.
    expect(await ids([{ column: 'label', operator: 'like', value: 'a%' }])).toEqual(['e2'])
    expect(await ids([{ column: 'label', operator: 'ilike', value: 'A%' }])).toEqual([
      'e1',
      'e2',
      'e3',
    ])
    // is.true / is.false compare booleans, not a string spelling of them.
    expect(await ids([{ column: 'flag', operator: 'is', value: true }])).toEqual(['e1'])
    expect(await ids([{ column: 'flag', operator: 'is', value: false }])).toEqual([])
    // is.null covers missing values; the spelling 'null' is not null.
    expect(await ids([{ column: 'empty', operator: 'is', value: null }])).toEqual(['e1', 'e3'])
    expect(await ids([{ column: 'spelled', operator: 'is', value: null }])).toEqual([])
    // in compares whole array elements, commas included.
    expect(await ids([{ column: 'combo', operator: 'in', value: ['a,b'] }])).toEqual(['e1'])
    expect(await ids([{ column: 'combo', operator: 'in', value: ['a'] }])).toEqual(['e3'])
    // neq.null is IS NOT NULL for a real null value too, so a missing value is excluded.
    expect(await ids([{ column: 'empty', operator: 'neq', value: null }])).toEqual(['e2'])
    // match never matches a missing value, even against the string 'undefined'.
    expect(await ids([{ column: 'missing', operator: 'match', value: 'undefined' }])).toEqual([])
  })

  it('supports typed is/in filters and rejects unknown operators', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('records')
    await db.insert('records', { id: 'a', enabled: false, value: null })
    await db.insert('records', { id: 'b', enabled: true, value: 'present' })

    expect(
      await db.select('records', {
        filters: [{ column: 'enabled', operator: 'is', value: false }],
      }),
    ).toHaveLength(1)
    expect(
      await db.select('records', {
        filters: [{ column: 'value', operator: 'is', value: null }],
      }),
    ).toHaveLength(1)
    expect(
      await db.select('records', {
        filters: [{ column: 'id', operator: 'in', value: ['a', 'b'] }],
      }),
    ).toHaveLength(2)
    await expect(
      db.select('records', {
        filters: [{ column: 'id', operator: 'unsupported', value: 'a' }],
      }),
    ).rejects.toThrow('Unsupported filter operator')
  })

  it('projects requested fields after filtering without exposing unrequested values', async () => {
    const db: IDatabase = new MemoryDatabaseAdapter()
    await db.createTable('projection')
    await db.insert('projection', { id: 'one', label: 'first', hidden: 'internal-one' })
    await db.insert('projection', { id: 'two', label: 'second', hidden: 'internal-two' })
    expect(
      await db.select('projection', {
        columns: ['label'],
        filters: [{ column: 'id', operator: 'eq', value: 'one' }],
      }),
    ).toEqual([{ label: 'first' }])
    expect(await db.select('projection', { columns: [] })).toEqual([{}, {}])
    expect(
      await db.select('projection', {
        columns: ['label'],
        filters: [{ column: 'id', operator: 'eq', value: 'missing' }],
      }),
    ).toEqual([])
    expect((await db.select('projection', {}))[0]?.hidden).toBe('internal-one')
  })

  it('does not claim unsafe record-table schema mutation support', () => {
    expect(hasDatabaseSchemaCapability(new MemoryDatabaseAdapter())).toBe(false)
  })
})
