/**
 * DirSize calculates the total size of a directory recursively.
 *
 * Port of common filesystem size utilities (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Uses Bun.file() for efficient file stat operations.
 *
 * @example
 *   const bytes = await DirSize("/path/to/directory")
 *   console.log(bytes) // 1024000
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

// --------------------------------------------------
// Public API
// --------------------------------------------------

/**
 * Calculates the total size in bytes of all files under `path`, recursively.
 *
 * Symbolic links are not followed (matching Go's default walk behavior).
 *
 * @param path - The directory path to calculate size for.
 * @returns Total size in bytes.
 * @throws If the path does not exist or cannot be read.
 */
export async function DirSize(path: string): Promise<number> {
  let totalSize = 0;

  const entries = await readdir(path, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(path, entry.name);

    if (entry.isSymbolicLink()) {
      // Skip symlinks to match Go behavior
      continue;
    }

    if (entry.isFile()) {
      const file = Bun.file(fullPath);
      totalSize += file.size ?? 0;
    } else if (entry.isDirectory()) {
      totalSize += await DirSize(fullPath);
    }
    // Other entry types (sockets, pipes) are skipped
  }

  return totalSize;
}
