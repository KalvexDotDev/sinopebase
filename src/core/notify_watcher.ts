/**
 * File change watcher for auto-reload.
 *
 * Port of PocketBase's file watcher (Go -> TypeScript).
 *
 * Watches a directory for file changes and triggers a callback.
 * Useful for development auto-reload when pb_data or migrations change.
 */

import type { FSWatcher } from 'node:fs'
import { watch } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Watcher event types.
 */
export type WatcherEvent = 'change' | 'rename'

/**
 * Callback for file change notifications.
 */
export type WatcherCallback = (event: WatcherEvent, filename: string) => void

/**
 * File watcher for monitoring directory changes.
 */
export class NotifyWatcher {
  private watcher: FSWatcher | null = null
  private callback: WatcherCallback
  private debounceMs: number

  /** Debounce timer for coalescing rapid changes. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Creates a new NotifyWatcher.
   *
   * @param callback - Called when a file changes.
   * @param debounceMs - Debounce interval in ms (default 300).
   */
  constructor(callback: WatcherCallback, debounceMs = 300) {
    this.callback = callback
    this.debounceMs = debounceMs
  }

  /**
   * Starts watching the specified directory.
   *
   * @param dirPath - The directory to watch.
   */
  watch(dirPath: string): void {
    this.stop()

    this.watcher = watch(resolve(dirPath), (event, filename) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }

      this.debounceTimer = setTimeout(() => {
        if (filename) {
          this.callback(event as WatcherEvent, filename)
        }
      }, this.debounceMs)
    })
  }

  /**
   * Stops watching.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}
