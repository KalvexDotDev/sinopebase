import { describe, expect, it } from 'bun:test'
import { CreateField } from '~/core/field.ts'
import {
  DefaultFileFieldMaxSize,
  FieldTypeFile,
  FileField,
  looseFilenameRegex,
} from '~/core/field_file.ts'

describe('FileField', () => {
  it('has type "file"', () => {
    const f = new FileField()
    expect(f.type).toBe(FieldTypeFile)
  })

  it('can be created via factory', () => {
    const f = CreateField('file')
    expect(f).toBeInstanceOf(FileField)
  })

  it('defaults to single file', () => {
    const f = new FileField()
    expect(f.isMultiple).toBe(false)
  })

  describe('columnType', () => {
    it('returns TEXT for single file', () => {
      const f = new FileField()
      expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
    })

    it('returns JSON for multi file', () => {
      const f = new FileField()
      f.maxSelect = 3
      expect(f.columnType).toBe("JSON DEFAULT '[]' NOT NULL")
    })
  })

  it('effectiveMaxSize defaults to 5MB', () => {
    const f = new FileField()
    expect(f.effectiveMaxSize).toBe(DefaultFileFieldMaxSize)
  })

  it('effectiveMaxSize uses configured maxSize', () => {
    const f = new FileField()
    f.maxSize = 1000
    expect(f.effectiveMaxSize).toBe(1000)
  })

  it('effectiveMaxSelect returns at least 1', () => {
    const f = new FileField()
    expect(f.effectiveMaxSelect).toBe(1)
    f.maxSelect = 0
    expect(f.effectiveMaxSelect).toBe(1)
    f.maxSelect = 5
    expect(f.effectiveMaxSelect).toBe(5)
  })

  describe('normalizeValue', () => {
    it('returns last filename for single file', () => {
      const f = new FileField()
      expect(f.normalizeValue(['a.txt', 'b.txt'])).toBe('b.txt')
    })

    it('returns empty string for empty single file', () => {
      const f = new FileField()
      expect(f.normalizeValue([])).toBe('')
    })

    it('returns array for multi file', () => {
      const f = new FileField()
      f.maxSelect = 3
      expect(f.normalizeValue(['a.txt', 'b.txt'])).toEqual(['a.txt', 'b.txt'])
    })
  })

  describe('looseFilenameRegex', () => {
    it('validates filenames', () => {
      expect(looseFilenameRegex.test('file.txt')).toBe(true)
      expect(looseFilenameRegex.test('my_file_v1.jpg')).toBe(true)
      expect(looseFilenameRegex.test('.hidden')).toBe(false)
      expect(looseFilenameRegex.test('path/name.txt')).toBe(false)
    })
  })

  describe('validateSettings', () => {
    it('validates thumb patterns', () => {
      const f = new FileField()
      f.id = 'fld1'
      f.name = 'file'
      f.thumbs = ['100x100', '200x200t']
      expect(f.validateSettings().filter((e) => e.includes('thumbs'))).toHaveLength(0)

      f.thumbs = ['0x0']
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('thumbs'))).toBe(true)
    })

    it('validates maxSize range', () => {
      const f = new FileField()
      f.id = 'fld1'
      f.name = 'file'
      f.maxSize = -1
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('maxSize'))).toBe(true)
    })
  })
})
