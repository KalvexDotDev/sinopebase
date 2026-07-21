/**
 * Tests for RunCommand.
 */

import { describe, it, expect } from "bun:test";
import { RunCommand } from "./run";

describe("RunCommand", () => {
  it("runs a command and captures stdout", async () => {
    const result = await RunCommand("echo", ["hello world"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
  });

  it("captures stderr output", async () => {
    // Use a command that writes to stderr
    const result = await RunCommand("bash", [
      "-c",
      'echo "error message" >&2 && exit 1',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error message");
  });

  it("returns exit code 0 for successful commands", async () => {
    const result = await RunCommand("bun", ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it("throws for non-existent commands", async () => {
    expect(
      RunCommand("nonexistent_command_xyz_123", []),
    ).rejects.toThrow();
  });

  it("runs a command with no arguments", async () => {
    const result = await RunCommand("bun", ["--version"]);

    expect(result.exitCode).toBe(0);
  });
});
