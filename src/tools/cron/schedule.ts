/**
 * Cron expression parser.
 *
 * Ported from PocketBase's tools/cron/schedule.go (MIT license).
 *
 * Parses standard 5-field cron expressions (minute, hour, day-of-month,
 * month, day-of-week) and determines whether a given moment satisfies
 * the schedule.
 *
 * Supported segment formats:
 *   - wildcard: asterisk
 *   - range:    1-30
 *   - step:     asterisk/n or 1-30/n
 *   - list:     1,2,3,10-20/n
 *
 * Supported macros:
 *   - at-yearly / at-annually  -> 0 0 1 1 asterisk
 *   - at-monthly               -> 0 0 1 asterisk asterisk
 *   - at-weekly                -> 0 0 asterisk asterisk 0
 *   - at-daily / at-midnight   -> 0 0 asterisk asterisk asterisk
 *   - at-hourly                -> 0 asterisk asterisk asterisk asterisk
 */

// ---------------------------------------------------------------------------
// Time component representation
// ---------------------------------------------------------------------------

/**
 * A parsed single time moment, representing the fields that cron
 * expressions match against.
 */
export interface Moment {
  minute: number
  hour: number
  day: number
  month: number
  dayOfWeek: number
}

/**
 * Creates a [[Moment]] from a JavaScript Date for the given IANA timezone.
 *
 * @param date     The date to extract components from.
 * @param timezone IANA timezone string (e.g. "UTC", "America/New_York").
 */
export function newMoment(date: Date, timezone: string): Moment {
  // Use Intl.DateTimeFormat to obtain components in the target timezone.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: 'numeric',
    hour: 'numeric',
    hour12: false,
    day: 'numeric',
    month: 'numeric',
    weekday: 'long',
  })
  const parts = formatter.formatToParts(date)

  const getNumeric = (type: string): number => {
    const p = parts.find((part) => part.type === type)
    return p ? Number.parseInt(p.value, 10) : 0
  }

  // JS weekday → cron day-of-week (0 = Sunday).
  const weekdayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  }

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sunday'

  return {
    minute: getNumeric('minute'),
    hour: getNumeric('hour'),
    day: getNumeric('day'),
    month: getNumeric('month'),
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Parsed cron schedule. Stores the set of acceptable values for each
 * time component.
 */
export class Schedule {
  /** Acceptable minute values (0–59). */
  readonly minutes: ReadonlySet<number>
  /** Acceptable hour values (0–23). */
  readonly hours: ReadonlySet<number>
  /** Acceptable day-of-month values (1–31). */
  readonly days: ReadonlySet<number>
  /** Acceptable month values (1–12). */
  readonly months: ReadonlySet<number>
  /** Acceptable day-of-week values (0–6, 0 = Sunday). */
  readonly daysOfWeek: ReadonlySet<number>
  /** The original raw expression. */
  readonly rawExpr: string

  constructor(opts: {
    minutes: Set<number>
    hours: Set<number>
    days: Set<number>
    months: Set<number>
    daysOfWeek: Set<number>
    rawExpr: string
  }) {
    this.minutes = opts.minutes
    this.hours = opts.hours
    this.days = opts.days
    this.months = opts.months
    this.daysOfWeek = opts.daysOfWeek
    this.rawExpr = opts.rawExpr
  }

  /**
   * Checks whether the provided [[Moment]] satisfies this schedule.
   * **All** fields must match (logical AND).
   */
  isDue(m: Moment): boolean {
    if (!this.minutes.has(m.minute)) return false
    if (!this.hours.has(m.hour)) return false
    if (!this.days.has(m.day)) return false
    if (!this.daysOfWeek.has(m.dayOfWeek)) return false
    if (!this.months.has(m.month)) return false
    return true
  }
}

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses a cron expression into a [[Schedule]].
 *
 * @param cronExpr A cron macro or a 5-segment expression.
 * @returns The parsed schedule.
 * @throws {Error} If the expression is invalid.
 *
 * @example
 * ```ts
 * const s = newSchedule("0 0 * * *"); // daily at midnight
 * const s2 = newSchedule("0 9-17 * * 1-5"); // 9am-5pm weekdays
 * ```
 */
export function newSchedule(cronExpr: string): Schedule {
  // Expand macros.
  const expr = MACROS[cronExpr] ?? cronExpr

  const segments = expr.trim().split(/\s+/)
  if (segments.length !== 5) {
    throw new Error(
      'Invalid cron expression – must be a valid macro or have exactly 5 space-separated segments',
    )
  }

  const segMinute = segments[0]
  const segHour = segments[1]
  const segDay = segments[2]
  const segMonth = segments[3]
  const segDayOfWeek = segments[4]
  if (
    segMinute === undefined ||
    segHour === undefined ||
    segDay === undefined ||
    segMonth === undefined ||
    segDayOfWeek === undefined
  ) {
    throw new Error('Invalid cron expression – insufficient segments')
  }
  const minutes = parseCronSegment(segMinute, 0, 59)
  const hours = parseCronSegment(segHour, 0, 23)
  const days = parseCronSegment(segDay, 1, 31)
  const months = parseCronSegment(segMonth, 1, 12)
  const daysOfWeek = parseCronSegment(segDayOfWeek, 0, 6)

  return new Schedule({
    minutes,
    hours,
    days,
    months,
    daysOfWeek,
    rawExpr: expr,
  })
}

/**
 * Parses a single cron segment.
 *
 * Supports wildcard (`asterisk`), range (`1-30`), step (`asterisk/n` or `1-30/n`), and list (`1,3,5`) formats.
 *
 * @param segment The raw segment string.
 * @param min     Minimum valid value (inclusive).
 * @param max     Maximum valid value (inclusive).
 * @returns A set of matching integer slots.
 */
function parseCronSegment(segment: string, min: number, max: number): Set<number> {
  const slots = new Set<number>()
  const list = segment.split(',')

  for (const item of list) {
    const stepParts = item.split('/')

    // ---- step ----
    let step: number
    if (stepParts.length === 1) {
      step = 1
    } else if (stepParts.length === 2) {
      const stepVal = stepParts[1]
      if (stepVal === undefined) {
        throw new Error(`Invalid segment step format in "${item}"`)
      }
      const parsedStep = Number.parseInt(stepVal, 10)
      if (Number.isNaN(parsedStep) || parsedStep < 1 || parsedStep > max) {
        throw new Error(`Invalid segment step – must be between 1 and ${max}, got "${stepVal}"`)
      }
      step = parsedStep
    } else {
      throw new Error(
        `Invalid segment step format - expected "asterisk/n" or "1-30/n", got "${item}"`,
      )
    }

    // ---- range ----
    let rangeMin: number
    let rangeMax: number

    const rangeBase = stepParts[0]
    if (rangeBase === undefined) {
      throw new Error(`Invalid segment format in "${item}"`)
    }

    if (rangeBase === '*') {
      rangeMin = min
      rangeMax = max
    } else {
      const rangeParts = rangeBase.split('-')

      if (rangeParts.length === 1) {
        if (step !== 1) {
          throw new Error(
            `Invalid segment step – step > 1 requires wildcard or range format, got "${item}"`,
          )
        }
        const valStr = rangeParts[0]
        if (valStr === undefined) {
          throw new Error(`Invalid segment value in "${item}"`)
        }
        const val = Number.parseInt(valStr, 10)
        if (Number.isNaN(val) || val < min || val > max) {
          throw new Error(
            `Invalid segment value – must be between ${min} and ${max}, got "${valStr}"`,
          )
        }
        rangeMin = val
        rangeMax = val
      } else if (rangeParts.length === 2) {
        const pMinStr = rangeParts[0]
        if (pMinStr === undefined) {
          throw new Error(`Invalid segment range minimum in "${item}"`)
        }
        const pMin = Number.parseInt(pMinStr, 10)
        if (Number.isNaN(pMin) || pMin < min || pMin > max) {
          throw new Error(
            `Invalid segment range minimum – must be between ${min} and ${max}, got "${pMinStr}"`,
          )
        }
        rangeMin = pMin

        const pMaxStr = rangeParts[1]
        if (pMaxStr === undefined) {
          throw new Error(`Invalid segment range maximum in "${item}"`)
        }
        const pMax = Number.parseInt(pMaxStr, 10)
        if (Number.isNaN(pMax) || pMax < rangeMin || pMax > max) {
          throw new Error(
            `Invalid segment range maximum – must be between ${rangeMin} and ${max}, got "${pMaxStr}"`,
          )
        }
        rangeMax = pMax
      } else {
        throw new Error(`Invalid segment range format – expected 1 or 2 parts, got "${rangeBase}"`)
      }
    }

    // ---- fill slots ----
    for (let i = rangeMin; i <= rangeMax; i += step) {
      slots.add(i)
    }
  }

  return slots
}

export { MACROS }
