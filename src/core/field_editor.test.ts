import { describe, expect, it } from 'bun:test'
import { CreateField } from '~/core/field.ts'
import { DefaultEditorFieldMaxSize, EditorField, FieldTypeEditor } from '~/core/field_editor.ts'

describe('EditorField', () => {
  it('has type "editor"', () => {
    const f = new EditorField()
    expect(f.type).toBe(FieldTypeEditor)
  })

  it('can be created via factory', () => {
    const f = CreateField('editor')
    expect(f).toBeInstanceOf(EditorField)
  })

  it('column type is TEXT', () => {
    const f = new EditorField()
    expect(f.columnType).toBe("TEXT DEFAULT '' NOT NULL")
  })

  it('settings schema is string', () => {
    const f = new EditorField()
    expect(f.settingsSchema.type).toBe('string')
    expect(f.settingsSchema.default).toBe('')
  })

  it('effectiveMaxSize defaults to 5MB', () => {
    const f = new EditorField()
    expect(f.effectiveMaxSize).toBe(DefaultEditorFieldMaxSize)
  })

  it('effectiveMaxSize uses configured maxSize', () => {
    const f = new EditorField()
    f.maxSize = 1000
    expect(f.effectiveMaxSize).toBe(1000)
  })

  describe('validateValue', () => {
    it('returns null for empty value when not required', () => {
      const f = new EditorField()
      expect(f.validateValue('')).toBeNull()
    })

    it('returns error for empty value when required', () => {
      const f = new EditorField()
      f.required = true
      expect(f.validateValue('')).not.toBeNull()
    })

    it('validates max size', () => {
      const f = new EditorField()
      f.maxSize = 10
      expect(f.validateValue('a'.repeat(11))).not.toBeNull()
    })

    it('passes valid content', () => {
      const f = new EditorField()
      expect(f.validateValue('<p>Hello world</p>')).toBeNull()
    })
  })

  describe('validateSettings', () => {
    it('validates maxSize range', () => {
      const f = new EditorField()
      f.id = 'fld1'
      f.name = 'editor'
      f.maxSize = -1
      const errors = f.validateSettings()
      expect(errors.some((e) => e.includes('maxSize'))).toBe(true)
    })
  })

  it('convertURLs defaults to false', () => {
    const f = new EditorField()
    expect(f.convertURLs).toBe(false)
  })
})
