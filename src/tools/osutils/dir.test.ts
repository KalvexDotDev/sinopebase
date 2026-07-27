/**
 * Tests for DirSize.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirSize } from './dir'

describe('DirSize', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'pb_dirsiz_test_'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns 0 for an empty directory', async () => {
    const size = await DirSize(testDir)
    expect(size).toBe(0)
  })

  it('returns the size of a single file', async () => {
    writeFileSync(join(testDir, 'file.bin'), Buffer.alloc(1024))

    const size = await DirSize(testDir)
    expect(size).toBe(1024)
  })

  it('returns the cumulative size of multiple files', async () => {
    writeFileSync(join(testDir, 'a.bin'), Buffer.alloc(500))
    writeFileSync(join(testDir, 'b.bin'), Buffer.alloc(1500))

    const size = await DirSize(testDir)
    expect(size).toBe(2000)
  })

  it('recursively calculates sizes in nested directories', async () => {
    mkdirSync(join(testDir, 'sub1'), { recursive: true })
    mkdirSync(join(testDir, 'sub1', 'sub2'), { recursive: true })

    writeFileSync(join(testDir, 'root.txt'), Buffer.alloc(100))
    writeFileSync(join(testDir, 'sub1', 'a.txt'), Buffer.alloc(200))
    writeFileSync(join(testDir, 'sub1', 'sub2', 'b.txt'), Buffer.alloc(300))

    const size = await DirSize(testDir)
    expect(size).toBe(600)
  })

  it('throws for a non-existent path', async () => {
    const missingPath = join(testDir, 'nonexistent')

    expect(DirSize(missingPath)).rejects.toThrow()
  })
})
