import { describe, it, expect } from 'bun:test'
import { JSONField, FieldTypeJSON, DefaultJSONFieldMaxSize } from '~/core/field_json.ts'
import { CreateField } from '~/core/field.ts'

describe('JSONField', () => {
  it('has type "json"', () => {
    const f = new JSONField()
    expect(f.type).toBe(FieldTypeJSON)
  })

  it('can be created via factory', () => {
    const f = CreateField('json')
    expect(f).toBeInstanceOf(JSONField)
  })

  it('column type is JSON', () => {
    const f = new JSONField()
    expect(f.columnType).toBe('JSON DEFAULT NULL')
  })

  it('settings schema accepts multiple types', () => {
    const f = new JSONField()
    const schema = f.settingsSchema
    expect(Array.isArray(schema.type)).toBe(true)
    expect(schema.default).toBeNull()
  })

  it('effectiveMaxSize defaults to 1MB', () => {
    const f = new JSONField()
    expect(f.effectiveMaxSize).toBe(DefaultJSONFieldMaxSize)
  })

  it('effectiveMaxSize uses configured maxSize when set', () => {
    const f = new JSONField()
    f.maxSize = 5000
    expect(f.effectiveMaxSize).toBe(5000)
  })

  describe('validateValue', () => {
    it('validates JSON format', () => {
      const f = new JSONField()
      expect(f.validateValue('{"key": "value"}')).toBeNull()
    })

    it('rejects invalid JSON', () => {
      const f = new JSONField()
      expect(f.validateValue('{invalid json}')).not.toBeNull()
    })

    it('validates size limits', () => {
      const f = new JSONField()
      f.maxSize = 10
      expect(f.validateValue('{"very long json value that exceeds limit": true}')).not.toBeNull()
    })

    it('validates required for empty values', () => {
      const f = new JSONField()
      f.required = true
      expect(f.validateValue('null')).not.toBeNull()
    })

    it('passes valid JSON when required', () => {
      const f = new JSONField()
      f.required = true
      expect(f.validateValue('{"key": "value"}')).toBeNull()
    })
  })
})
