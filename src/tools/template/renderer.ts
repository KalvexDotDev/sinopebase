/**
 * Port of PocketBase tools/template/renderer.go
 *
 * Template renderer with variable interpolation.
 * Layer 0 -- zero internal dependencies.
 */

/**
 * Renders a template string by replacing `{{var}}` patterns with
 * corresponding values from the `data` object.
 *
 * - Missing keys keep the original `{{key}}` placeholder.
 * - Values are coerced to strings via `String()`.
 *
 * @example
 *   Render("Hello {{name}}!", { name: "World" })
 *   // => "Hello World!"
 */
export function Render(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in data) {
      const value = data[key]
      if (value === null || value === undefined) {
        return ''
      }
      return String(value)
    }
    // Keep the placeholder as-is when the key is missing.
    return `{{${key}}}`
  })
}
