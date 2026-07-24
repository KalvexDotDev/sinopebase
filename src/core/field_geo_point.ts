/**
 * GeoPointField — stores geographic coordinates (longitude/latitude).
 *
 * Port of PocketBase's GeoPoint type (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import { RegisterField, ValidateFieldName, ValidateFieldId } from '~/core/field.ts'
import type { Field } from '~/core/field.ts'

export const FieldTypeGeoPoint = 'geo_point'

/**
 * GeoPointField defines a "geo_point" type field for storing geographic
 * coordinates (longitude, latitude).
 *
 * The respective zero record field value is null.
 */
export class GeoPointField implements Field {
  id: string = ''
  name: string = ''
  system: boolean = false
  hidden: boolean = false
  readonly type: string = FieldTypeGeoPoint

  /** Hints the Dashboard UI to use this field in relation preview labels. */
  presentable: boolean = false

  /** Help text shown in the Dashboard UI. */
  help: string = ''

  /** Whether the field is required. */
  required: boolean = false

  /** SQL column type for this field. */
  get columnType(): string {
    return 'JSON DEFAULT NULL'
  }

  /** JSON Schema fragment for API validation. */
  get settingsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        lon: { type: 'number', minimum: -180, maximum: 180 },
        lat: { type: 'number', minimum: -90, maximum: 90 },
      },
      required: this.required ? ['lon', 'lat'] : [],
      additionalProperties: false,
      default: null,
    }
  }

  /** Validates a coordinate pair. */
  validateValue(value: { lon: number; lat: number } | null): string | null {
    if (value === null || value === undefined) {
      if (this.required) {
        return 'Value is required'
      }
      return null
    }

    if (typeof value !== 'object' || value === null) {
      return 'Must be a valid geo point object with lon and lat properties'
    }

    const lon = (value as Record<string, unknown>)['lon']
    const lat = (value as Record<string, unknown>)['lat']

    if (typeof lon !== 'number' || !isFinite(lon) || Math.abs(lon) > 180) {
      return 'Longitude must be a finite number between -180 and 180'
    }

    if (typeof lat !== 'number' || !isFinite(lat) || Math.abs(lat) > 90) {
      return 'Latitude must be a finite number between -90 and 90'
    }

    return null
  }

  /** Validates the field settings/configuration. */
  validateSettings(): string[] {
    const errors: string[] = []

    const idErr = ValidateFieldId(this.id)
    if (idErr) errors.push(`id: ${idErr}`)

    const nameErr = ValidateFieldName(this.name)
    if (nameErr) errors.push(`name: ${nameErr}`)

    if (this.help && (this.help.length < 1 || this.help.length > 300)) {
      errors.push('help: must be between 1 and 300 characters')
    }

    return errors
  }
}

// Register with the field factory
RegisterField(FieldTypeGeoPoint, () => new GeoPointField())
