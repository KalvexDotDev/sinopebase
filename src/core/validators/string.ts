/**
 * String validators — regex and IP/subnet checks.
 *
 * Port of PocketBase's core/validators/string.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

import type { ValidationRule } from '~/core/validators/validators.ts'
import { ErrUnsupportedValueType, ValidationError } from '~/core/validators/validators.ts'

/**
 * Validates that the given value is a valid regular expression pattern.
 *
 * Returns null for empty strings (nothing to check).
 *
 * @example
 *   validateField(form.Pattern, IsRegex)
 */
export const IsRegex: ValidationRule = (value: unknown): ValidationError | null => {
  if (typeof value !== 'string') {
    return ErrUnsupportedValueType
  }

  if (value === '') {
    return null // nothing to check
  }

  try {
    new RegExp(value)
    return null
  } catch (err) {
    return new ValidationError(
      'validation_invalid_regex',
      err instanceof Error ? err.message : 'Invalid regex pattern',
    )
  }
}

/**
 * Validates that the given value is an IPv4/IPv6 address or a CIDR subnet.
 *
 * Returns null for empty strings (nothing to check).
 *
 * @example
 *   validateField(form.AllowedIP, IPOrSubnet)
 */
export const IPOrSubnet: ValidationRule = (value: unknown): ValidationError | null => {
  if (typeof value !== 'string') {
    return ErrUnsupportedValueType
  }

  if (value === '') {
    return null // nothing to check
  }

  // Try CIDR notation (contains '/')
  if (value.includes('/')) {
    try {
      // Simple CIDR validation: must have a valid prefix length after '/'
      const parts = value.split('/')
      if (parts.length !== 2) throw new Error()
      const prefixLen = Number(parts[1])
      if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) throw new Error()

      // Validate the IP part
      const ipParts = parts[0]!.split('.')
      if (ipParts.length === 4) {
        // IPv4 CIDR
        for (const p of ipParts) {
          const n = Number(p)
          if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error()
        }
        if (prefixLen > 32) throw new Error()
        // Also validate IPv6 CIDR
      } else if (parts[0]!.includes(':')) {
        // IPv6 CIDR — validate basic hex format
        const hexGroups = parts[0]!.split(':')
        if (hexGroups.length < 2 || hexGroups.length > 8) throw new Error()
      } else {
        throw new Error()
      }

      return null
    } catch {
      return new ValidationError(
        'validation_invalid_ip_or_subnet',
        'Invalid IP or CIDR subnet',
      )
    }
  }

  // Try individual IP (IPv4)
  const ipParts = value.split('.')
  if (ipParts.length === 4) {
    try {
      for (const p of ipParts) {
        const n = Number(p)
        if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error()
      }
      return null
    } catch {
      // Fall through to error
    }
  }

  // Try individual IP (IPv6 basic check)
  if (value.includes(':') && value.split(':').length >= 2 && value.split(':').length <= 8) {
    return null
  }

  return new ValidationError(
    'validation_invalid_ip_or_subnet',
    'Invalid IP or CIDR subnet',
  )
}
