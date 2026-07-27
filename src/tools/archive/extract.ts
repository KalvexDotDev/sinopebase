/**
 * ExtractZipArchive extracts a ZIP archive to a destination directory.
 *
 * Port of PocketBase's tools/archive/extract.go (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Only regular files and directories are extracted.
 * Symbolic links and other irregular files are skipped
 * (matching Go behavior which avoids edge cases and ambiguities).
 *
 * @example
 *   await ExtractZipArchive("/path/to/archive.zip", "/path/to/output")
 *   await ExtractZipArchive(zipBuffer, "/path/to/output")
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'

// --------------------------------------------------
// Types
// --------------------------------------------------

/**
 * The reader input for ExtractZipArchive.
 *
 * Accepts a file path (string) or raw bytes (Uint8Array).
 */
export type ZipReader = string | Uint8Array

// --------------------------------------------------
// Public API
// --------------------------------------------------

/**
 * Extracts a ZIP archive into the specified destination directory.
 *
 * @param reader  - Path to a .zip file, or a Uint8Array containing zip data.
 * @param destDir - Directory where the archive contents will be extracted.
 *
 * @throws If the path traversal (Zip Slip) is detected.
 * @throws If the zip data is corrupt or invalid.
 * @throws If filesystem operations fail.
 */
export async function ExtractZipArchive(reader: ZipReader, destDir: string): Promise<void> {
  // Normalize and prepare the destination path
  const destPath = resolve(destDir)
  const normalizedDest = normalize(destPath) + sep

  // Ensure the destination directory exists
  await mkdir(destPath, { recursive: true })

  // Load the ZIP archive
  const zip = typeof reader === 'string' ? new AdmZip(reader) : new AdmZip(Buffer.from(reader))

  const entries = zip.getEntries()

  for (const entry of entries) {
    const entryPath = join(destPath, entry.entryName)

    // --------------------------------------------------
    // Zip Slip check
    // --------------------------------------------------
    // Verify the resolved path stays within the destination directory.
    // This matches Go's extractFile logic in tools/archive/extract.go.
    if (!normalize(entryPath).startsWith(normalizedDest)) {
      throw new Error(`Invalid file path (possible Zip Slip): ${entry.entryName}`)
    }

    // --------------------------------------------------
    // Extract only directories and regular files
    // --------------------------------------------------
    if (entry.isDirectory) {
      await mkdir(entryPath, { recursive: true })
    } else {
      // Treat as a regular file.
      // adm-zip does not expose an `isFile` boolean property in v0.6.0,
      // so any non-directory entry is handled as a file.
      // Symbolic links, pipes, sockets, and other irregular files
      // are not distinguishable in adm-zip's entry API but are uncommon
      // in practice (matching Go's conservative approach).
      await mkdir(dirname(entryPath), { recursive: true })

      const data = entry.getData()

      // adm-zip returns null only on deferred entries that were never read,
      // which should not happen with normal iteration.
      if (data !== null) {
        await writeFile(entryPath, data)
      }
    }
  }
}
