/**
 * Identifier macros for search filter expressions.
 *
 * Port of PocketBase tools/search/identifier_macros.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { DateTime } from "~/tools/types/datetime";

/**
 * Function type for a macro that resolves to a value.
 */
export type MacroFunc = () => unknown;

/**
 * Returns the current UTC time.  Exported so tests can override it.
 */
export function nowUTC(): Date {
  return new Date();
}

/**
 * All registered identifier macros.
 *
 * These are injected as placeholder parameters when a filter expression
 * references them (e.g. `@now`, `@year`, etc.).
 */
export const identifierMacros: Record<string, MacroFunc> = {
  "@now": () => {
    const d = DateTime.ParseDateTime(nowUTC());
    return d.String();
  },

  "@yesterday": () => {
    const yesterday = new Date(nowUTC().getTime() - 86400000);
    const d = DateTime.ParseDateTime(yesterday);
    return d.String();
  },

  "@tomorrow": () => {
    const tomorrow = new Date(nowUTC().getTime() + 86400000);
    const d = DateTime.ParseDateTime(tomorrow);
    return d.String();
  },

  "@second": () => nowUTC().getUTCSeconds(),

  "@minute": () => nowUTC().getUTCMinutes(),

  "@hour": () => nowUTC().getUTCHours(),

  "@day": () => nowUTC().getUTCDate(),

  "@month": () => nowUTC().getUTCMonth() + 1, // JS months are 0-indexed

  "@weekday": () => nowUTC().getUTCDay(), // 0=Sun, 6=Sat

  "@year": () => nowUTC().getUTCFullYear(),

  "@todayStart": () => {
    const today = nowUTC();
    const start = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const d = DateTime.ParseDateTime(start);
    return d.String();
  },

  "@todayEnd": () => {
    const today = nowUTC();
    const end = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
    const d = DateTime.ParseDateTime(end);
    return d.String();
  },

  "@monthStart": () => {
    const today = nowUTC();
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const d = DateTime.ParseDateTime(start);
    return d.String();
  },

  "@monthEnd": () => {
    const today = nowUTC();
    const end = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );
    const d = DateTime.ParseDateTime(end);
    return d.String();
  },

  "@yearStart": () => {
    const today = nowUTC();
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    const d = DateTime.ParseDateTime(start);
    return d.String();
  },

  "@yearEnd": () => {
    const today = nowUTC();
    const end = new Date(
      Date.UTC(today.getUTCFullYear(), 11, 31, 23, 59, 59, 999),
    );
    const d = DateTime.ParseDateTime(end);
    return d.String();
  },
};
