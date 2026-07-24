/**
 * Tests for Logger.
 */

import { describe, it, expect } from "bun:test";
import { ConsoleLogger, LogLevel } from "./log";
import type { Logger } from "./log";

describe("LogLevel", () => {
  it("has expected numeric values", () => {
    expect(LogLevel.Debug).toBe(-4);
    expect(LogLevel.Info).toBe(0);
    expect(LogLevel.Warn).toBe(4);
    expect(LogLevel.Error).toBe(8);
  });
});

describe("ConsoleLogger", () => {
  it("writes an info message without throwing", () => {
    const logger = new ConsoleLogger();

    expect(() => {
      logger.Write(LogLevel.Info, "test message");
    }).not.toThrow();
  });

  it("writes a debug message without throwing", () => {
    const logger = new ConsoleLogger();

    expect(() => {
      logger.Write(LogLevel.Debug, "debug message");
    }).not.toThrow();
  });

  it("writes a warn message without throwing", () => {
    const logger = new ConsoleLogger();

    expect(() => {
      logger.Write(LogLevel.Warn, "warn message");
    }).not.toThrow();
  });

  it("writes an error message without throwing", () => {
    const logger = new ConsoleLogger();

    expect(() => {
      logger.Write(LogLevel.Error, "error message");
    }).not.toThrow();
  });

  it("writes a message with structured data", () => {
    const logger = new ConsoleLogger();

    expect(() => {
      logger.Write(LogLevel.Info, "user login", {
        userId: "abc123",
        role: "admin",
      });
    }).not.toThrow();
  });

  it("writes a message with empty data", () => {
    const logger = new ConsoleLogger();

    expect(() => {
      logger.Write(LogLevel.Info, "no data", {});
    }).not.toThrow();
  });

  it("implements the Logger interface", () => {
    const logger: Logger = new ConsoleLogger();

    expect(logger.Write).toBeFunction();
  });
});
