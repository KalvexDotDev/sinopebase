/**
 * Base validator types and utilities.
 *
 * Port of PocketBase's core/validators/validators.go (Go -> TypeScript).
 * Layer 2 — imports from ~/tools/*.
 */

/**
 * ValidationError represents a named validation error with optional params.
 */
export class ValidationError extends Error {
  readonly code: string
  readonly params?: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    params?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ValidationError'
    this.code = code
    this.params = params
  }

  /**
   * Returns a new ValidationError with the given params merged in.
   */
  withParams(params: Record<string, unknown>): ValidationError {
    return new ValidationError(this.code, this.message, { ...this.params, ...params })
  }
}

/**
 * ValidationErrors is a map of field name -> error, used for structured validation failures.
 */
export class ValidationErrors extends Error {
  readonly errors: Record<string, ValidationError>

  constructor(
    errors: Record<string, ValidationError>,
  ) {
    super('Validation failed')
    this.name = 'ValidationErrors'
    this.errors = errors
  }
}

/**
 * ErrUnsupportedValueType is returned when a validator receives a value
 * of an unexpected type.
 */
export const ErrUnsupportedValueType = new ValidationError(
  'validation_unsupported_value_type',
  'Invalid or unsupported value type.',
)

/**
 * Standard validation rule type.
 * Returns a ValidationError if validation fails, or null if valid.
 */
export type ValidationRule = (value: unknown) => ValidationError | null

/**
 * Attempts to join two validation errors.
 *
 * - If both are ValidationErrors, they are merged into one.
 * - If only one is non-empty ValidationErrors, it is returned.
 * - Otherwise, the errors are joined via message concatenation.
 */
export function JoinValidationErrors(errA: Error | null, errB: Error | null): Error | null {
  if (!errA && !errB) return null
  if (!errA) return errB
  if (!errB) return errA

  const vErrA = errA instanceof ValidationErrors ? errA.errors : null
  const vErrB = errB instanceof ValidationErrors ? errB.errors : null

  if (vErrA && vErrB) {
    const merged: Record<string, ValidationError> = { ...vErrA, ...vErrB }
    if (Object.keys(merged).length > 0) {
      return new ValidationErrors(merged)
    }
  }

  if (vErrA && Object.keys(vErrA).length > 0) return errA
  if (vErrB && Object.keys(vErrB).length > 0) return errB

  return new Error(`${errA.message}; ${errB.message}`)
}

/**
 * Truncates a string to the given max length, appending "..." if truncated.
 */
export function cutStr(str: string, max: number): string {
  if (str.length > max) {
    return str.slice(0, max) + '...'
  }
  return str
}
