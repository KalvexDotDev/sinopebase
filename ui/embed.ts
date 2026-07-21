/**
 * Stub for Svelte admin UI embedding.
 *
 * Port of PocketBase's ui/embed.go (Go -> TypeScript).
 * Layer 5 -- zero internal dependencies.
 *
 * The admin UI is a Svelte application. When built, it goes in `ui/dist/`.
 * This module provides the embed interface that serves the built admin UI.
 *
 * For now, this returns empty/mock implementations. A future iteration will
 * import the built Svelte SPA and serve it as static files.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Admin UI descriptor — metadata about the embedded admin interface.
 */
export interface AdminUI {
  /** Whether the admin UI is available (built and embedded). */
  available: boolean

  /** Path prefix where the admin UI is served (e.g., "/_/"). */
  pathPrefix: string

  /** Version hash of the built UI (empty if not available). */
  versionHash: string
}

// ---------------------------------------------------------------------------
// Admin UI metadata
// ---------------------------------------------------------------------------

/** The admin UI path prefix used by PocketBase. */
export const AdminUIPathPrefix = '/_/'

/**
 * Current admin UI metadata.
 */
export const adminUI: AdminUI = {
  available: false,
  pathPrefix: AdminUIPathPrefix,
  versionHash: '',
}

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

/**
 * Represents a static file served from the admin UI.
 */
export interface UIFile {
  /** File path within the admin UI. */
  path: string

  /** File content as bytes (for serving). */
  content: Uint8Array

  /** Content-Type header value. */
  contentType: string
}

/**
 * Returns the list of all embedded admin UI files.
 *
 * Currently returns an empty array. When the Svelte admin UI is built
 * and embedded, this will return the actual file listing.
 *
 * @returns An empty array (stub).
 */
export function getUIFiles(): UIFile[] {
  return []
}

/**
 * Finds a specific file in the embedded admin UI by path.
 *
 * @param _path - The file path to look up.
 * @returns The UIFile or undefined if not found.
 */
export function getUIFile(_path: string): UIFile | undefined {
  return undefined
}

/**
 * Returns the index.html content for the admin SPA.
 *
 * This is used as the fallback for all admin UI routes
 * (client-side routing via the Svelte router).
 *
 * Currently returns a placeholder HTML page.
 *
 * @returns HTML string for the admin UI shell.
 */
export function getAdminIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sinopebase Admin</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 80vh;
    }
    .placeholder {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .placeholder h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    .placeholder p {
      margin: 0;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="placeholder">
    <h1>Sinopebase Admin</h1>
    <p>Admin UI is not yet embedded. Build the Svelte app to <code>ui/dist/</code> to enable it.</p>
  </div>
</body>
</html>`
}

/**
 * Initializes the admin UI by loading built files from `ui/dist/`.
 *
 * Call this during application bootstrap to load the embedded admin UI.
 *
 * @param distPath - Path to the built admin UI dist directory.
 */
export async function initAdminUI(distPath: string = './ui/dist'): Promise<void> {
  try {
    const dir = Bun.file(distPath)
    const exists = await dir.exists()

    if (!exists) {
      console.log('[ui] Admin UI dist not found at:', distPath)
      return
    }

    // Check for index.html to confirm a valid build
    const indexPath = `${distPath}/index.html`
    const indexFile = Bun.file(indexPath)
    if (!(await indexFile.exists())) {
      console.log('[ui] Admin UI not built yet (no index.html in dist)')
      return
    }

    // Mark as available
    ;(adminUI as { available: boolean }).available = true
    console.log('[ui] Admin UI loaded from:', distPath)
  } catch (err) {
    console.warn('[ui] Failed to load admin UI:', err instanceof Error ? err.message : String(err))
  }
}
