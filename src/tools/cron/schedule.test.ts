import { describe, expect, it } from 'bun:test'
import { newMoment, newSchedule } from './schedule.ts'

describe('newSchedule', () => {
  // -----------------------------------------------------------------------
  // Macros
  // -----------------------------------------------------------------------
  it('parses @yearly macro', () => {
    const s = newSchedule('@yearly')
    expect(s.minutes.has(0)).toBe(true)
    expect(s.hours.has(0)).toBe(true)
    expect(s.days.has(1)).toBe(true)
    expect(s.months.has(1)).toBe(true)
    expect(s.daysOfWeek.has(0)).toBe(true)
  })

  it('parses @annually macro', () => {
    const s = newSchedule('@annually')
    expect(s.isDue({ minute: 0, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
  })

  it('parses @monthly macro', () => {
    const s = newSchedule('@monthly')
    expect(s.isDue({ minute: 0, hour: 0, day: 1, month: 6, dayOfWeek: 0 })).toBe(true)
  })

  it('parses @weekly macro', () => {
    const s = newSchedule('@weekly')
    // Every Sunday (0) at midnight
    expect(s.isDue({ minute: 0, hour: 0, day: 15, month: 6, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 0, day: 15, month: 6, dayOfWeek: 1 })).toBe(false)
  })

  it('parses @daily macro', () => {
    const s = newSchedule('@daily')
    expect(s.isDue({ minute: 0, hour: 0, day: 10, month: 5, dayOfWeek: 3 })).toBe(true)
    expect(s.isDue({ minute: 1, hour: 0, day: 10, month: 5, dayOfWeek: 3 })).toBe(false)
  })

  it('parses @midnight macro', () => {
    const s = newSchedule('@midnight')
    const d = { minute: 0, hour: 0, day: 1, month: 1, dayOfWeek: 0 }
    expect(s.isDue(d)).toBe(true)
  })

  it('parses @hourly macro', () => {
    const s = newSchedule('@hourly')
    expect(s.isDue({ minute: 0, hour: 5, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 30, hour: 5, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Wildcards
  // -----------------------------------------------------------------------
  it('parses wildcard expression', () => {
    const s = newSchedule('* * * * *')
    // Every minute of every hour of every day
    expect(s.isDue({ minute: 0, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 59, hour: 23, day: 31, month: 12, dayOfWeek: 6 })).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Specific values
  // -----------------------------------------------------------------------
  it('parses specific minute values', () => {
    const s = newSchedule('30 * * * *')
    expect(s.isDue({ minute: 30, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  it('parses specific hour and minute', () => {
    const s = newSchedule('0 9 * * *')
    expect(s.isDue({ minute: 0, hour: 9, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 10, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Ranges
  // -----------------------------------------------------------------------
  it('parses range expressions', () => {
    const s = newSchedule('0 9-17 * * *')
    expect(s.isDue({ minute: 0, hour: 9, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 17, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 18, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Steps
  // -----------------------------------------------------------------------
  it('parses step expressions with wildcard', () => {
    const s = newSchedule('*/15 * * * *')
    expect(s.isDue({ minute: 0, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 15, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 30, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 45, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 10, hour: 0, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  it('parses step expressions with range', () => {
    const s = newSchedule('0 9-17/2 * * *')
    expect(s.isDue({ minute: 0, hour: 9, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 11, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 13, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 10, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Lists
  // -----------------------------------------------------------------------
  it('parses list expressions', () => {
    const s = newSchedule('0,30 9,18 * * *')
    expect(s.isDue({ minute: 0, hour: 9, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 30, hour: 9, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 30, hour: 18, day: 1, month: 1, dayOfWeek: 0 })).toBe(true)
    expect(s.isDue({ minute: 15, hour: 9, day: 1, month: 1, dayOfWeek: 0 })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Day of week
  // -----------------------------------------------------------------------
  it('parses weekday-only schedules', () => {
    const s = newSchedule('0 9 * * 1-5')
    expect(s.isDue({ minute: 0, hour: 9, day: 1, month: 1, dayOfWeek: 1 })).toBe(true)
    expect(s.isDue({ minute: 0, hour: 9, day: 1, month: 1, dayOfWeek: 6 })).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  it('throws on empty expression', () => {
    expect(() => newSchedule('')).toThrow()
  })

  it('throws on invalid segment count', () => {
    expect(() => newSchedule('* * * *')).toThrow()
    expect(() => newSchedule('* * * * * *')).toThrow()
  })

  it('throws on invalid segment value', () => {
    expect(() => newSchedule('60 * * * *')).toThrow()
    expect(() => newSchedule('* 24 * * *')).toThrow()
  })

  it('throws on invalid step', () => {
    expect(() => newSchedule('*/0 * * * *')).toThrow()
    expect(() => newSchedule('*/61 * * * *')).toThrow()
  })

  it('throws on step with single value without range', () => {
    expect(() => newSchedule('5/2 * * * *')).toThrow()
  })

  it('throws on invalid macro', () => {
    expect(() => newSchedule('@invalid')).toThrow()
  })
})

describe('newMoment', () => {
  it('extracts components from a date in UTC', () => {
    // 2024-01-15 09:30:00 UTC is a Monday
    const date = new Date('2024-01-15T09:30:00Z')
    const m = newMoment(date, 'UTC')
    expect(m.minute).toBe(30)
    expect(m.hour).toBe(9)
    expect(m.day).toBe(15)
    expect(m.month).toBe(1)
    expect(m.dayOfWeek).toBe(1) // Monday
  })

  it('handles timezone conversion', () => {
    // 2024-01-15 05:00:00 UTC = 2024-01-15 00:00:00 EST
    const date = new Date('2024-01-15T05:00:00Z')
    const m = newMoment(date, 'America/New_York')
    expect(m.hour).toBe(0)
    expect(m.minute).toBe(0)
  })
})
