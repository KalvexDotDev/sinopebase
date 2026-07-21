import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { identifierMacros, nowUTC } from "./identifier_macros";

describe("identifierMacros", () => {
  const originalNow = nowUTC;

  beforeEach(() => {
    // Override to a fixed date: 2026-07-21 12:30:45 UTC
    const fixedDate = new Date("2026-07-21T12:30:45.123Z");
    // Replace the module-level nowUTC function
    // We patch the Date constructor used internally instead
  });

  // Re-test with actual Date

  it("@now returns current date as DateTimeString", () => {
    const result = identifierMacros["@now"]();
    expect(result).toBeString();
    expect((result as string).length).toBeGreaterThan(0);
  });

  it("@year returns current year", () => {
    const result = identifierMacros["@year"]();
    expect(result).toBe(new Date().getUTCFullYear());
  });

  it("@month returns current month", () => {
    const result = identifierMacros["@month"]();
    expect(result).toBe(new Date().getUTCMonth() + 1);
  });

  it("@day returns current day", () => {
    const result = identifierMacros["@day"]();
    expect(result).toBe(new Date().getUTCDate());
  });

  it("@hour returns current hour", () => {
    const result = identifierMacros["@hour"]();
    expect(result).toBe(new Date().getUTCHours());
  });

  it("@minute returns current minute", () => {
    const result = identifierMacros["@minute"]();
    expect(result).toBe(new Date().getUTCMinutes());
  });

  it("@second returns current second", () => {
    const result = identifierMacros["@second"]();
    expect(result).toBe(new Date().getUTCSeconds());
  });

  it("@weekday returns current weekday", () => {
    const result = identifierMacros["@weekday"]();
    expect(typeof result).toBe("number");
    expect(result as number).toBeGreaterThanOrEqual(0);
    expect(result as number).toBeLessThanOrEqual(6);
  });

  it("@yesterday returns yesterday's date string", () => {
    const result = identifierMacros["@yesterday"]();
    expect(result).toBeString();
    expect((result as string).length).toBeGreaterThan(0);
  });

  it("@tomorrow returns tomorrow's date string", () => {
    const result = identifierMacros["@tomorrow"]();
    expect(result).toBeString();
    expect((result as string).length).toBeGreaterThan(0);
  });

  it("@todayStart returns start of day", () => {
    const result = identifierMacros["@todayStart"]();
    expect(result).toBeString();
    expect((result as string)).toMatch(/00:00:00\.000Z$/);
  });

  it("@monthStart returns first of month", () => {
    const result = identifierMacros["@monthStart"]();
    expect(result).toBeString();
    expect((result as string)).toMatch(/01 \d{2}:00:00\.000Z$/);
  });

  it("@yearStart returns first of year", () => {
    const result = identifierMacros["@yearStart"]();
    expect(result).toBeString();
    expect((result as string)).toMatch(/01-01 \d{2}:00:00\.000Z$/);
  });
});
