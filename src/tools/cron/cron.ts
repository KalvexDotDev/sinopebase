/**
 * Crontab-like service to execute and schedule repetitive tasks/jobs.
 *
 * Ported from PocketBase's tools/cron/cron.go (MIT license).
 *
 * @example
 * ```ts
 * import { Cron } from "./cron.ts";
 *
 * const c = new Cron();
 * c.add("dailyReport", "0 0 * * *", () => { console.log("Daily report"); });
 * c.start();
 * ```
 */

import { fireAndForget } from '../routine/routine.ts'
import { Job } from './job.ts'
import { newMoment, newSchedule } from './schedule.ts'

/**
 * Crontab-like scheduler for repeating tasks.
 *
 * The cron ticks at the configured interval (default 1 minute) and
 * executes any job whose schedule matches the current time.
 */
export class Cron {
  /** IANA timezone string (default "UTC"). */
  #timezone: string

  /** Interval handle (setInterval return value) when running. */
  #ticker: ReturnType<typeof setInterval> | null = null

  /** Start-up timer handle (setTimeout) for aligning with the next boundary. */
  #startTimer: ReturnType<typeof setTimeout> | null = null

  /** Registered jobs. */
  #jobs: Job[] = []

  /** Tick interval in milliseconds (default 60 000). */
  #intervalMs: number

  /**
   * Creates a new Cron with a default tick interval of 1 minute and UTC
   * timezone.
   */
  constructor() {
    this.#intervalMs = 60_000
    this.#timezone = 'UTC'
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Changes the tick interval.
   *
   * If the cron is currently started it will be restarted so the new
   * interval takes effect immediately.
   *
   * @param ms Interval in milliseconds (usually >= 60 000).
   */
  setInterval(ms: number): void {
    const wasStarted = this.#ticker !== null
    this.#intervalMs = ms
    if (wasStarted) {
      this.start()
    }
  }

  /**
   * Returns the current tick interval in milliseconds.
   */
  getInterval(): number {
    return this.#intervalMs
  }

  /**
   * Changes the timezone used when evaluating job schedules.
   *
   * @param tz IANA timezone string (e.g. "UTC", "America/New_York").
   */
  setTimezone(tz: string): void {
    this.#timezone = tz
  }

  /**
   * Returns the current IANA timezone string.
   */
  getTimezone(): string {
    return this.#timezone
  }

  /**
   * Returns a shallow copy of the currently registered jobs.
   */
  getJobs(): Job[] {
    return [...this.#jobs]
  }

  // -----------------------------------------------------------------------
  // Job management
  // -----------------------------------------------------------------------

  /**
   * Registers a single cron job.
   *
   * If a job with the same `jobId` already exists it is replaced.
   *
   * @param jobId    Unique identifier for the job.
   * @param cronExpr Cron expression. Example: "0 0 * * *" for daily at midnight.
   * @param fn       Function to execute when the schedule fires.
   * @throws {Error} If `fn` is null/undefined or the expression is invalid.
   */
  add(jobId: string, cronExpr: string, fn: () => void): void {
    if (typeof fn !== 'function') {
      throw new Error('Failed to add cron job: fn must be a function')
    }
    const schedule = newSchedule(cronExpr)

    // Remove existing job with the same id.
    this.#jobs = this.#jobs.filter((j) => j.id !== jobId)

    this.#jobs.push(new Job(jobId, schedule, fn))
  }

  /**
   * Convenience wrapper around [[add]] that throws on failure.
   *
   * @deprecated Use [[add]] which already throws on failure.
   */
  mustAdd(jobId: string, cronExpr: string, fn: () => void): void {
    this.add(jobId, cronExpr, fn)
  }

  /**
   * Removes a single cron job by its id.
   */
  remove(jobId: string): void {
    this.#jobs = this.#jobs.filter((j) => j.id !== jobId)
  }

  /** Removes all registered cron jobs. */
  removeAll(): void {
    this.#jobs = []
  }

  /** Returns the total number of registered cron jobs. */
  get total(): number {
    return this.#jobs.length
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Starts the cron ticker.
   *
   * The first tick is delayed until the start of the next interval
   * boundary (e.g. the next full minute for a 60s interval).
   *
   * Calling `start()` on an already-running cron restarts it.
   */
  start(): void {
    this.stop()

    const now = Date.now()
    const nextBoundary = Math.ceil(now / this.#intervalMs) * this.#intervalMs
    const delay = nextBoundary - now

    this.#startTimer = setTimeout(() => {
      this.#startTimer = null

      // Run due jobs immediately on the boundary.
      this.#runDue()

      // Then set up the periodic ticker.
      this.#ticker = setInterval(() => {
        this.#runDue()
      }, this.#intervalMs)
    }, delay)
  }

  /**
   * Stops the cron ticker (if running).
   *
   * Call [[start]] to resume.
   */
  stop(): void {
    if (this.#startTimer !== null) {
      clearTimeout(this.#startTimer)
      this.#startTimer = null
    }
    if (this.#ticker !== null) {
      clearInterval(this.#ticker)
      this.#ticker = null
    }
  }

  /** Returns `true` if the cron ticker is currently running. */
  get hasStarted(): boolean {
    return this.#ticker !== null || this.#startTimer !== null
  }

  /** Returns `true` if the periodic ticker has fired at least once. */
  get isRunning(): boolean {
    return this.#ticker !== null
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Evaluates all registered jobs against the current time and fires
   * due ones in the background.
   */
  #runDue(): void {
    const moment = newMoment(new Date(), this.#timezone)

    for (const job of this.#jobs) {
      if (job.schedule.isDue(moment)) {
        fireAndForget(() => job.run())
      }
    }
  }
}
