/**
 * CreateZipArchive creates a ZIP archive from multiple file sources.
 *
 * Port of PocketBase's tools/archive/create.go (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Uses the adm-zip library for ZIP file creation.
 *
 * @example
 *   await CreateZipArchive(
 *     [{ path: "/path/to/file.txt" }, { path: "/path/to/dir", name: "mydir" }],
 *     "/path/to/output.zip",
 *     ["skip_this.txt", "skip_dir/sub"],
 *   )
 */

import { mkdir, stat, readdir } from "node:fs/promises";
import { resolve, dirname, basename, join, relative, normalize } from "node:path";
import AdmZip from "adm-zip";

// --------------------------------------------------
// Types
// --------------------------------------------------

/**
 * ZipSource describes a file or directory to include in the archive.
 *
 * Equivalent to PocketBase's source path argument in archive.Create().
 */
export interface ZipSource {
  /** Path to a file or directory on disk. */
  path: string;

  /**
   * Optional custom name/path within the archive.
   * If omitted, the basename of `path` is used.
   */
  name?: string;
}

// --------------------------------------------------
// Internal helpers
// --------------------------------------------------

/**
 * Normalizes a path to use forward slashes for consistent matching across platforms.
 */
function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, "/");
}

/**
 * Checks whether `relPath` matches any entry in `skipSet`.
 *
 * A skip entry matches if:
 *   - relPath === skipEntry (exact match), or
 *   - relPath starts with skipEntry + "/" (directory prefix match).
 *
 * This mirrors the Go logic in archive.zipAddFS.
 */
function shouldSkip(relPath: string, skipSet: Set<string>): boolean {
  const normalized = normalizePath(relPath);

  for (const sp of skipSet) {
    if (
      normalized === sp ||
      normalized.startsWith(sp + "/")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively walks a directory and collects regular file entries.
 *
 * Symlinks are skipped to match Go's fs.WalkDir behavior
 * which does not follow symlinks by default.
 */
async function collectFiles(
  root: string,
  current: string,
  arcPrefix: string,
  skipSet: Set<string>,
  files: Array<{ fsPath: string; arcPath: string }>,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    const relPath = relative(root, fullPath);
    const arcPath = arcPrefix
      ? normalizePath(join(arcPrefix, relPath))
      : relPath;

    // Skip symlinks (matches Go's fs.WalkDir behavior)
    if (entry.isSymbolicLink()) {
      continue;
    }

    // Check skip list
    if (shouldSkip(relPath, skipSet) || shouldSkip(entry.name, skipSet)) {
      continue;
    }

    if (entry.isFile()) {
      files.push({ fsPath: fullPath, arcPath });
    } else if (entry.isDirectory()) {
      // Only recurse if the directory itself is not being skipped
      await collectFiles(root, fullPath, arcPrefix, skipSet, files);
    }
    // Other entry types (sockets, pipes, etc.) are implicitly skipped
  }
}

/**
 * Splits an archive path into directory and filename components.
 *
 * Example: "dir1/dir2/file.txt" -> { dir: "dir1/dir2", name: "file.txt" }
 */
function splitArcPath(arcPath: string): { dir: string; name: string } {
  const normalized = normalizePath(arcPath);
  const idx = normalized.lastIndexOf("/");

  if (idx >= 0) {
    return {
      dir: normalized.substring(0, idx),
      name: normalized.substring(idx + 1),
    };
  }

  return { dir: "", name: normalized };
}

// --------------------------------------------------
// Public API
// --------------------------------------------------

/**
 * Creates a ZIP archive from one or more file/directory sources.
 *
 * Mirrors PocketBase's archive.Create() but with support for multiple
 * source paths and per-entry archive names.
 *
 * @param sources   - One or more source paths (files or directories).
 * @param dest      - Destination path for the resulting .zip file.
 * @param skipPaths - Optional list of path patterns to skip (relative to each source root).
 *
 * @throws If a source path does not exist.
 * @throws If the destination directory cannot be created.
 * @throws If ZIP writing fails.
 */
export async function CreateZipArchive(
  sources: ZipSource[],
  dest: string,
  skipPaths?: string[],
): Promise<void> {
  const destPath = resolve(dest);

  // Ensure the destination directory exists
  await mkdir(dirname(destPath), { recursive: true });

  const zip = new AdmZip();
  const skipSet = new Set(
    (skipPaths ?? []).map((p) => normalizePath(p)),
  );

  for (const source of sources) {
    const srcPath = resolve(source.path);
    const arcName = source.name ?? basename(srcPath);

    const srcStat = await stat(srcPath);

    if (srcStat.isFile()) {
      // Single file source
      const base = basename(srcPath);
      if (!shouldSkip(base, skipSet)) {
        zip.addLocalFile(srcPath, "", arcName);
      }
    } else if (srcStat.isDirectory()) {
      // Directory source -- walk and collect files
      const collected: Array<{ fsPath: string; arcPath: string }> = [];
      await collectFiles(srcPath, srcPath, arcName, skipSet, collected);

      for (const { fsPath, arcPath } of collected) {
        const { dir, name: zipName } = splitArcPath(arcPath);
        zip.addLocalFile(fsPath, dir, zipName);
      }
    }
    // Symlinks and other types are implicitly skipped
    // (the stat call would work for symlinks too, but we
    //  keep the behavior aligned with Go's WalkDir)
  }

  zip.writeZip(destPath);
}
