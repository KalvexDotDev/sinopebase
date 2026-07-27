/**
 * Port of PocketBase tools/template/registry.go
 *
 * Template registry for named template functions.
 * Layer 0 -- zero internal dependencies.
 */

/**
 * Signature for a registered template function.
 * Receives the data object and returns the rendered string.
 */
export type TemplateFn = (data: Record<string, unknown>) => string

/**
 * A thread-safe (by JS single-threaded nature) registry of named template
 * functions.
 *
 * @example
 *   const reg = new Registry();
 *   reg.Register("greet", (data) => `Hello ${data.name ?? "World"}!`);
 *   reg.Render("greet", { name: "Jane" }); // "Hello Jane!"
 */
export class Registry {
  /** @internal */
  private readonly templates = new Map<string, TemplateFn>()

  // -----------------------------------------------------------------------
  // Register
  // -----------------------------------------------------------------------

  /**
   * Registers a template function under the given name.
   * If a function with that name already exists it is replaced.
   */
  Register(name: string, fn: TemplateFn): void {
    this.templates.set(name, fn)
  }

  // -----------------------------------------------------------------------
  // Get
  // -----------------------------------------------------------------------

  /**
   * Retrieves a previously registered template function, or `undefined`
   * if no function is registered under `name`.
   */
  Get(name: string): TemplateFn | undefined {
    return this.templates.get(name)
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  /**
   * Looks up the template function registered as `name` and invokes it
   * with `data`, returning the rendered string.
   *
   * Throws if `name` has not been registered.
   */
  Render(name: string, data: Record<string, unknown>): string {
    const fn = this.Get(name)
    if (fn === undefined) {
      throw new Error(`Template "${name}" not found`)
    }
    return fn(data)
  }
}
