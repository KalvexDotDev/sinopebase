/**
 * replaceWithExpression — SQL identifier placeholder replacement.
 *
 * Port of PocketBase core/record_field_resolver_replace_expr.go (MIT license).
 * Layer 2 — imports from ~/tools/*.
 *
 * Allows a placeholder identifier in a built SQL expression to be
 * replaced with the result of another expression at build time.
 * Used by the `:changed` modifier for @request.body field filters.
 */

/**
 * ReplaceWithExpression holds a placeholder string that, when `build()` is
 * called, gets replaced inside the `old` expression with the `new` expression.
 *
 * This is used by the RecordFieldResolver to implement the `:changed` modifier:
 * a placeholder token is injected during resolution and replaced with
 * the actual @request.body change-check sub-expression after the full
 * filter expression is assembled.
 */
export class ReplaceWithExpression {
  /**
   * @param placeholder - The literal string to search for inside `old`.
   * @param old         - The SQL expression that contains `placeholder`.
   * @param new         - The SQL expression to substitute in place of `placeholder`.
   */
  placeholder: string
  old: string
  new_: string

  constructor(
    placeholder: string,
    old: string,
    new_: string,
  ) {
    this.placeholder = placeholder
    this.old = old
    this.new_ = new_
  }

  /**
   * Returns the SQL fragment with all occurrences of `placeholder`
   * replaced by `new_`.
   *
   * Returns "0=1" (always false) if required fields are missing.
   */
  build(): string {
    if (!this.placeholder || !this.old || !this.new_) {
      return '0=1';
    }

    return this.old.split(this.placeholder).join(this.new_);
  }
}
