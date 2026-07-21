import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Cron } from "./cron.ts";

describe("Cron", () => {
  let cron: Cron;

  beforeEach(() => {
    cron = new Cron();
  });

  afterEach(() => {
    cron.stop();
  });

  it("starts with no jobs", () => {
    expect(cron.total).toBe(0);
  });

  it("add registers a job", () => {
    cron.add("test", "0 0 * * *", () => {});
    expect(cron.total).toBe(1);
  });

  it("add replaces a job with the same id", () => {
    cron.add("test", "0 0 * * *", () => {});
    cron.add("test", "*/5 * * * *", () => {});
    expect(cron.total).toBe(1);
    const jobs = cron.getJobs();
    expect(jobs[0]?.expression).toBe("*/5 * * * *");
  });

  it("mustAdd works like add", () => {
    cron.mustAdd("test", "0 0 * * *", () => {});
    expect(cron.total).toBe(1);
  });

  it("remove deletes a job by id", () => {
    cron.add("test", "0 0 * * *", () => {});
    cron.remove("test");
    expect(cron.total).toBe(0);
  });

  it("removeAll clears all jobs", () => {
    cron.add("a", "0 0 * * *", () => {});
    cron.add("b", "0 0 * * *", () => {});
    cron.removeAll();
    expect(cron.total).toBe(0);
  });

  it("getJobs returns a shallow copy", () => {
    cron.add("test", "0 0 * * *", () => {});
    const jobs = cron.getJobs();
    expect(jobs.length).toBe(1);
    // Modifying the returned array shouldn't affect the cron
    cron.removeAll();
    expect(jobs.length).toBe(1); // this is the copy
  });

  it("starts and stops without error", () => {
    cron.add("test", "0 0 * * *", () => {});
    cron.start();
    expect(cron.hasStarted).toBe(true);
    cron.stop();
    expect(cron.hasStarted).toBe(false);
  });

  it("start can be called multiple times", () => {
    cron.start();
    cron.start();
    cron.start();
    cron.stop();
    expect(cron.hasStarted).toBe(false);
  });

  it("stop on non-running cron is safe", () => {
    cron.stop();
    expect(cron.hasStarted).toBe(false);
  });

  it("setInterval restarts if already started", async () => {
    cron.add("test", "0 0 * * *", () => {});
    cron.start();
    // Small delay for start-up timer to fire
    await new Promise((r) => setTimeout(r, 50));
    const wasStarted = cron.isRunning;
    cron.setInterval(120_000);
    // After restart it should still be running
    expect(cron.hasStarted).toBe(true);
    cron.stop();
  });

  it("setInterval does not auto-start if not started", () => {
    cron.setInterval(120_000);
    expect(cron.hasStarted).toBe(false);
  });

  it("setTimezone updates the timezone", () => {
    expect(cron.getTimezone()).toBe("UTC");
    cron.setTimezone("America/New_York");
    expect(cron.getTimezone()).toBe("America/New_York");
  });

  it("getInterval returns the current interval", () => {
    expect(cron.getInterval()).toBe(60_000);
    cron.setInterval(120_000);
    expect(cron.getInterval()).toBe(120_000);
  });

  it("throws when add gets a non-function", () => {
    expect(() => cron.add("bad", "0 0 * * *", undefined as unknown as () => void)).toThrow();
  });

  it("throws on invalid cron expression", () => {
    expect(() => cron.add("bad", "invalid", () => {})).toThrow();
  });
});
