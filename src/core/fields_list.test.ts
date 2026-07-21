import { describe, it, expect } from 'bun:test'
import { FieldsList } from '~/core/fields_list.ts'
import { TextField } from '~/core/field_text.ts'
import { NumberField } from '~/core/field_number.ts'
import { BoolField } from '~/core/field_bool.ts'
import { Fields } from '~/core/field.ts'

describe('FieldsList', () => {
  it('creates an empty list', () => {
    const list = new FieldsList()
    expect(list.length).toBe(0)
  })

  it('adds fields', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    const f2 = new NumberField()
    f2.id = 'fld2'
    f2.name = 'count'

    list.add(f1, f2)
    expect(list.length).toBe(2)
  })

  it('initializes with fields', () => {
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    const list = new FieldsList([f1])
    expect(list.length).toBe(1)
  })

  it('gets field by name', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    const found = list.getByName('title')
    expect(found).toBeDefined()
    expect(found!.id).toBe('fld1')
  })

  it('gets field by id', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    const found = list.getById('fld1')
    expect(found).toBeDefined()
    expect(found!.name).toBe('title')
  })

  it('returns all fields', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    const f2 = new NumberField()
    f2.id = 'fld2'
    f2.name = 'count'
    list.add(f1, f2)

    const all = list.all()
    expect(all).toHaveLength(2)
  })

  it('removes field by id', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)
    expect(list.length).toBe(1)

    list.removeById('fld1')
    expect(list.length).toBe(0)
  })

  it('removes field by name', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    list.removeByName('title')
    expect(list.length).toBe(0)
  })

  it('fieldNames returns all names', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    const f2 = new NumberField()
    f2.id = 'fld2'
    f2.name = 'count'
    list.add(f1, f2)

    expect(list.fieldNames()).toEqual(['title', 'count'])
  })

  it('asMap returns name-indexed fields', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    const map = list.asMap()
    expect(map['title']).toBeDefined()
    expect(map['title']!.id).toBe('fld1')
  })

  it('getAt returns field by index', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)
    expect(list.getAt(0)).toBeDefined()
    expect(list.getAt(0)!.name).toBe('title')
    expect(list.getAt(1)).toBeUndefined()
  })

  it('replaces existing field by id', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    const f2 = new TextField()
    f2.id = 'fld1' // same id
    f2.name = 'renamed'
    list.add(f2)

    expect(list.length).toBe(1)
    expect(list.getById('fld1')!.name).toBe('renamed')
  })

  it('replaces existing field by name when no id', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.name = 'title'
    list.add(f1)

    const f2 = new TextField()
    f2.name = 'title' // same name, no id
    list.add(f2)

    expect(list.length).toBe(1)
    // Should reuse the original id
  })

  it('auto-generates id for fields without one', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.name = 'title'
    list.add(f1)

    expect(f1.id).toBeTruthy()
    expect(f1.id).toMatch(/^text_\d+$/)
  })

  it('addAt inserts at position', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'first'
    const f2 = new TextField()
    f2.id = 'fld2'
    f2.name = 'second'
    list.add(f1, f2)

    const f3 = new BoolField()
    f3.id = 'fld3'
    f3.name = 'middle'
    list.addAt(1, f3)

    expect(list.length).toBe(3)
    expect(list.getAt(0)!.name).toBe('first')
    expect(list.getAt(1)!.name).toBe('middle')
    expect(list.getAt(2)!.name).toBe('second')
  })

  it('serializes to JSON', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    const json = list.toJSON()
    expect(json).toHaveLength(1)
    expect(json[0]!.type).toBe('text')
    expect(json[0]!.name).toBe('title')
  })

  it('toString returns JSON string', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    list.add(f1)

    const str = list.toString()
    expect(typeof str).toBe('string')
    expect(str).toContain('"name":"title"')
  })

  it('clones the list', () => {
    const list = new FieldsList()
    const f1 = new TextField()
    f1.id = 'fld1'
    f1.name = 'title'
    f1.required = true
    list.add(f1)

    const cloned = list.clone()
    expect(cloned.length).toBe(1)
    expect(cloned.getByName('title')).toBeDefined()
    expect(cloned.getByName('title')!.id).toBe('fld1')
    // Should be a different instance
    expect(cloned.getAt(0)).not.toBe(f1)
  })

  it('fromJSON creates list from parsed JSON', () => {
    // First ensure 'bool' is registered
    expect(Fields.has('bool')).toBe(true)

    const json = [
      { type: 'text', name: 'title', id: 'fld1' },
      { type: 'bool', name: 'active', id: 'fld2' },
    ]

    const list = FieldsList.fromJSON(json)
    expect(list.length).toBe(2)
    expect(list.getByName('title')).toBeInstanceOf(TextField)
    expect(list.getByName('active')).toBeInstanceOf(BoolField)
  })

  it('fromJSON handles JSON string', () => {
    const json = '[{"type":"text","name":"title","id":"fld1"}]'
    const list = FieldsList.fromJSON(json)
    expect(list.length).toBe(1)
    expect(list.getByName('title')).toBeDefined()
  })

  it('fromJSON creates generic fallback for unknown types', () => {
    const json = [
      { type: 'unknown_type', name: 'bad', id: 'fld1' },
      { type: 'text', name: 'good', id: 'fld2' },
    ]
    const list = FieldsList.fromJSON(json)
    expect(list.length).toBe(2) // unknown type preserved as generic field
    expect(list.getByName('bad')).toBeDefined()
    expect(list.getByName('good')).toBeDefined()
  })

  it('returns 0 for empty list via length', () => {
    const list = new FieldsList()
    expect(list.length).toBe(0)
  })
})
