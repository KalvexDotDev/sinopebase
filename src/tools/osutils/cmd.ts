/**
 * FindCommand locates an executable in the system PATH.
 *
 * Port of PocketBase's os/exec pattern (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Uses Bun.which() for PATH resolution.
 *
 * @example
 *   const path = await FindCommand("node")
 *   // /usr/local/bin/node
 *
 *   const path = FindCommandSync("bun")
 *   // /home/user/.bun/bin/bun
 */

// --------------------------------------------------
// Public API
// --------------------------------------------------

/**
 * Returns the full path to an executable found in the system PATH.
 *
 * Async wrapper around Bun.which().
 *
 * @param name - The executable name to locate (e.g. "node", "git", "bun").
 * @returns The absolute path to the executable, or null if not found.
 */
export async function FindCommand(name: string): Promise<string | null> {
  const result = Bun.which(name)
  return result ?? null
}

/**
 * Synchronously returns the full path to an executable found in the system PATH.
 *
 * @param name - The executable name to locate.
 * @returns The absolute path to the executable, or null if not found.
 */
export function FindCommandSync(name: string): string | null {
  const result = Bun.which(name)
  return result ?? null
}
