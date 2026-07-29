/**
 * GitHub release update checker plugin.
 *
 * Port of PocketBase's plugins/ghupdate/ghupdate.go (Go -> TypeScript).
 * Layer 5 -- imports from plugins/ghupdate/release.ts.
 *
 * Checks for newer releases on a configurable schedule and
 * logs a warning if a newer version is available.
 */

import type { App } from '~/core/app.ts'
import { fetchLatestRelease, isGreaterThan } from './release.ts'

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface GhUpdateOptions {
  /** GitHub repository owner (default: "sinopebase"). */
  owner?: string

  /** GitHub repository name (default: "sinopebase"). */
  repo?: string

  /** Current application version to compare against. */
  currentVersion: string

  /** Check interval in milliseconds (default: 24 hours). */
  checkIntervalMs?: number

  /** Whether to check on startup (default: true). */
  checkOnStartup?: boolean

  /** Custom update check URL (overrides GitHub API). */
  updateCheckUrl?: string
}

// ---------------------------------------------------------------------------
// GhUpdatePlugin
// ---------------------------------------------------------------------------

/**
 * GitHub release update checker plugin.
 *
 * Periodically checks for new releases and logs a warning when
 * a newer version is available.
 *
 * @example
 * ```ts
 * const plugin = new GhUpdatePlugin({
 *   currentVersion: '0.1.0',
 * })
 * await plugin.register(app)
 * ```
 */
export class GhUpdatePlugin {
  private options: GhUpdateOptions
  private timer: ReturnType<typeof setTimeout> | null = null
  private latestVersion: string | null = null

  constructor(options: GhUpdateOptions) {
    this.options = {
      owner: 'sinopebase',
      repo: 'sinopebase',
      checkIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
      checkOnStartup: true,
      ...options,
    }
  }

  /**
   * Returns the latest known version (null if not yet checked).
   */
  getLatestVersion(): string | null {
    return this.latestVersion
  }

  /**
   * Registers the update checker plugin with the application.
   *
   * @param app - The App instance (unused but follows plugin convention).
   */
  async register(_app: App): Promise<void> {
    // Check on startup if configured
    if (this.options.checkOnStartup) {
      await this.checkForUpdate()

      // Set up periodic checking
      this.timer = setInterval(async () => {
        await this.checkForUpdate()
      }, this.options.checkIntervalMs)

      // Allow the timer to not block process exit
      if (typeof this.timer === 'object' && 'unref' in this.timer) {
        ;(this.timer as ReturnType<typeof setTimeout>).unref()
      }
    }
  }

  /**
   * Manually trigger an update check.
   *
   * @returns The latest version string, or null if check failed.
   */
  async checkForUpdate(): Promise<string | null> {
    try {
      const release = await fetchLatestRelease(this.options.owner!, this.options.repo!)

      if (!release || !release.semver) {
        console.log('[ghupdate] Could not determine latest version')
        return null
      }

      this.latestVersion = release.tagName

      if (isGreaterThan(release.tagName, this.options.currentVersion)) {
        console.warn(
          `[ghupdate] New version available: ${release.tagName} ` +
            `(current: ${this.options.currentVersion})\n` +
            `  Download: ${release.htmlUrl}`,
        )
      } else {
        console.log(`[ghupdate] Up to date (${this.options.currentVersion})`)
      }

      return release.tagName
    } catch (err) {
      console.warn(
        '[ghupdate] Update check failed:',
        err instanceof Error ? err.message : String(err),
      )
      return null
    }
  }

  /**
   * Stops the periodic update checker.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
