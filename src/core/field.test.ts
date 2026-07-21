import { describe, it, expect } from 'bun:test'
import {
  FieldNameId,
  FieldNameCollectionId,
  FieldNameCollectionName,
  FieldNameExpand,
  FieldNameEmail,
  FieldNameEmailVisibility,
  FieldNameVerified,
  FieldNameTokenKey,
  FieldNamePassword,
  SystemDynamicFieldNames,
  RegisterField,
  Fields,
  CreateField,
  ValidateFieldName,
  ValidateFieldId,
  fieldNameRegex,
} from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

describe('Field name constants', () => {
  it('defines all standard field names', () => {
    expect(FieldNameId).toBe('id')
    expect(FieldNameCollectionId).toBe('collectionId')
    expect(FieldNameCollectionName).toBe('collectionName')
    expect(FieldNameExpand).toBe('expand')
    expect(FieldNameEmail).toBe('email')
    expect(FieldNameEmailVisibility).toBe('emailVisibility')
    expect(FieldNameVerified).toBe('verified')
    expect(FieldNameTokenKey).toBe('tokenKey')
    expect(FieldNamePassword).toBe('password')
  })
})

describe('SystemDynamicFieldNames', () => {
  it('contains the expected readonly fields', () => {
    expect(SystemDynamicFieldNames).toContain(FieldNameCollectionId)
    expect(SystemDynamicFieldNames).toContain(FieldNameCollectionName)
    expect(SystemDynamicFieldNames).toContain(FieldNameExpand)
  })
})

describe('RegisterField / CreateField', () => {
  it('registers and creates a field by type', () => {
    const testType = 'test_field'
    class TestField implements Field {
      id = ''
      name = ''
      system = false
      hidden = false
      readonly type = testType
      columnType = 'TEXT'
      settingsSchema = {}
    }
    RegisterField(testType, () => new TestField())

    const field = CreateField(testType)
    expect(field).toBeDefined()
    expect(field!.type).toBe(testType)
  })

  it('returns undefined for unknown type', () => {
    expect(CreateField('nonexistent')).toBeUndefined()
  })

  it('is resetting Fields map after test', () => {
    // Fields has entries from all registered field types
    expect(Fields.size).toBeGreaterThan(0)
  })
})

describe('ValidateFieldName', () => {
  it('rejects empty names', () => {
    expect(ValidateFieldName('')).not.toBeNull()
  })

  it('rejects names over 100 chars', () => {
    expect(ValidateFieldName('a'.repeat(101))).not.toBeNull()
  })

  it('rejects names with special characters', () => {
    expect(ValidateFieldName('my field')).not.toBeNull()
    expect(ValidateFieldName('field!')).not.toBeNull()
  })

  it('rejects reserved names', () => {
    expect(ValidateFieldName('null')).not.toBeNull()
    expect(ValidateFieldName('true')).not.toBeNull()
    expect(ValidateFieldName('false')).not.toBeNull()
    expect(ValidateFieldName('_rowid_')).not.toBeNull()
  })

  it('rejects names containing _via_', () => {
    expect(ValidateFieldName('rel_via_test')).not.toBeNull()
  })

  it('accepts valid names', () => {
    expect(ValidateFieldName('name')).toBeNull()
    expect(ValidateFieldName('email')).toBeNull()
    expect(ValidateFieldName('my_field_1')).toBeNull()
    expect(ValidateFieldName('description')).toBeNull()
  })

  it('validates fieldNameRegex correctly', () => {
    expect(fieldNameRegex.test('valid_name')).toBe(true)
    expect(fieldNameRegex.test('name123')).toBe(true)
    expect(fieldNameRegex.test('')).toBe(false)
    expect(fieldNameRegex.test('has space')).toBe(false)
    expect(fieldNameRegex.test('has-dash')).toBe(false)
  })
})

describe('ValidateFieldId', () => {
  it('rejects empty ids', () => {
    expect(ValidateFieldId('')).not.toBeNull()
  })

  it('rejects ids over 100 chars', () => {
    expect(ValidateFieldId('a'.repeat(101))).not.toBeNull()
  })

  it('accepts valid ids', () => {
    expect(ValidateFieldId('abc123')).toBeNull()
    expect(ValidateFieldId('fld_123')).toBeNull()
  })
})
