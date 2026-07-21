import { describe, it, expect } from 'bun:test'
import { GeoPointField, FieldTypeGeoPoint } from '~/core/field_geo_point.ts'
import { CreateField } from '~/core/field.ts'

describe('GeoPointField', () => {
  it('has type "geo_point"', () => {
    const f = new GeoPointField()
    expect(f.type).toBe(FieldTypeGeoPoint)
  })

  it('can be created via factory', () => {
    const f = CreateField('geo_point')
    expect(f).toBeInstanceOf(GeoPointField)
  })

  it('column type is JSON', () => {
    const f = new GeoPointField()
    expect(f.columnType).toBe('JSON DEFAULT NULL')
  })

  it('settings schema defines lon/lat properties', () => {
    const f = new GeoPointField()
    const schema = f.settingsSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    const props = schema.properties as Record<string, unknown>
    expect(props).toHaveProperty('lon')
    expect(props).toHaveProperty('lat')
    expect((props.lon as Record<string, unknown>).minimum).toBe(-180)
    expect((props.lon as Record<string, unknown>).maximum).toBe(180)
    expect((props.lat as Record<string, unknown>).minimum).toBe(-90)
    expect((props.lat as Record<string, unknown>).maximum).toBe(90)
  })

  describe('validateValue', () => {
    it('returns null for null value when not required', () => {
      const f = new GeoPointField()
      expect(f.validateValue(null)).toBeNull()
    })

    it('returns error for null value when required', () => {
      const f = new GeoPointField()
      f.required = true
      expect(f.validateValue(null)).not.toBeNull()
    })

    it('returns null for valid coordinates', () => {
      const f = new GeoPointField()
      expect(f.validateValue({ lon: 13.405, lat: 52.52 })).toBeNull()
    })

    it('rejects out of range longitude', () => {
      const f = new GeoPointField()
      expect(f.validateValue({ lon: 200, lat: 0 })).not.toBeNull()
    })

    it('rejects out of range latitude', () => {
      const f = new GeoPointField()
      expect(f.validateValue({ lon: 0, lat: 100 })).not.toBeNull()
    })

    it('rejects non-finite values', () => {
      const f = new GeoPointField()
      expect(f.validateValue({ lon: NaN, lat: 0 })).not.toBeNull()
      expect(f.validateValue({ lon: Infinity, lat: 0 })).not.toBeNull()
    })

    it('rejects non-object values', () => {
      const f = new GeoPointField()
      expect(f.validateValue('not-a-point' as unknown as null)).not.toBeNull()
    })
  })
})
