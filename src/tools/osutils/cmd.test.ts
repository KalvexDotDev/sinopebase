/**
 * Tests for FindCommand.
 */

import { describe, expect, it } from 'bun:test'
import { FindCommand, FindCommandSync } from './cmd'

describe('FindCommand', () => {
  it('finds an existing command in PATH', async () => {
    const path = await FindCommand('bun')

    expect(path).not.toBeNull()
    expect(path).toBeString()
    expect(path?.length).toBeGreaterThan(0)
  })

  it('returns null for a non-existent command', async () => {
    const path = await FindCommand('nonexistent_command_xyz_123')

    expect(path).toBeNull()
  })

  it('finds node (always available)', async () => {
    const path = await FindCommand('node')

    expect(path).not.toBeNull()
    expect(path).toBeString()
    expect(path?.length).toBeGreaterThan(0)
  })
})

describe('FindCommandSync', () => {
  it('finds an existing command synchronously', () => {
    const path = FindCommandSync('bun')

    expect(path).not.toBeNull()
    expect(path).toBeString()
    expect(path?.length).toBeGreaterThan(0)
  })

  it('returns null for a non-existent command synchronously', () => {
    const path = FindCommandSync('nonexistent_command_xyz_123')

    expect(path).toBeNull()
  })
})
