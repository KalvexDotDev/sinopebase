/**
 * Storage object names: no segment may be empty, `.` or `..` (sinope#1111).
 * @new-code-test positive src/tools/filesystem/object-name.ts
 * @new-code-test negative src/tools/filesystem/object-name.ts
 */

import { describe, expect, it } from 'bun:test'
import { isValidObjectName, isValidObjectPrefix } from '../../src/tools/filesystem/object-name'

const UNSAFE_NAMES = [
  '',
  '/',
  '.',
  '..',
  '/tenant-a/x.txt',
  'tenant-a/',
  'tenant-a//x.txt',
  'tenant-a/./x.txt',
  'tenant-a/../tenant-b/x.txt',
  '../tenant-b/x.txt',
  './x.txt',
  'tenant-a/..',
  'tenant-a/.',
]

describe('isValidObjectName', () => {
  it('accepts names whose segments are all file names', () => {
    for (const name of [
      'x.txt',
      'tenant-a/control/policy.pdf',
      'tenant-a/.emptyFolderPlaceholder',
      'tenant-a/...',
      'tenant-a/..x',
      'tenant-a/x..',
      'a%2F..%2Fb',
    ]) {
      expect(isValidObjectName(name)).toBe(true)
    }
  })

  it('rejects empty, dot and dot-dot segments and a leading slash', () => {
    for (const name of UNSAFE_NAMES) expect(isValidObjectName(name)).toBe(false)
  })

  it('rejects names that are not strings', () => {
    for (const name of [undefined, null, 1, ['x.txt'], { name: 'x.txt' }]) {
      expect(isValidObjectName(name)).toBe(false)
    }
  })
})

describe('isValidObjectPrefix', () => {
  it('accepts the bucket root and folder prefixes with or without a trailing slash', () => {
    for (const prefix of ['', 'tenant-a', 'tenant-a/', 'tenant-a/control/']) {
      expect(isValidObjectPrefix(prefix)).toBe(true)
    }
  })

  it('rejects prefixes containing unsafe segments', () => {
    for (const prefix of ['/', '//', 'tenant-a//', '../', 'tenant-a/../tenant-b/', './', 1]) {
      expect(isValidObjectPrefix(prefix)).toBe(false)
    }
  })
})
