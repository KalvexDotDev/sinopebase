/**
 * Cron job definition.
 *
 * Ported from PocketBase's tools/cron/job.go (MIT license).
 *
 * Wraps a function together with its schedule expression and unique id.
 */

import type { Schedule } from "./schedule.ts";

/**
 * A single registered cron job.
 */
export class Job {
  /** Unique identifier for this job. */
  readonly id: string;

  /** The parsed schedule this job runs on. */
  readonly schedule: Schedule;

  /** The function to execute. */
  readonly #run: () => void;

  constructor(id: string, schedule: Schedule, run: () => void) {
    this.id = id;
    this.schedule = schedule;
    this.#run = run;
  }

  /** Returns the raw cron expression. */
  get expression(): string {
    return this.schedule.rawExpr;
  }

  /** Executes the job function. */
  run(): void {
    this.#run();
  }

  /**
   * Custom JSON serialisation – returns only `id` and `expression` to
   * mirror the Go implementation.
   */
  toJSON(): { id: string; expression: string } {
    return {
      id: this.id,
      expression: this.expression,
    };
  }
}
