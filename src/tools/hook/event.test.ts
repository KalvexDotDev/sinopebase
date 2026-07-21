import { describe, it, expect } from "bun:test";
import { Event } from "./event.ts";

describe("Event", () => {
  it("next resolves when no handler is set", async () => {
    const e = new Event();
    await expect(e.next()).resolves.toBeUndefined();
  });

  it("next invokes a single handler", async () => {
    const e = new Event();
    const results: number[] = [];

    e.setNextFunc(() => {
      results.push(1);
      return Promise.resolve();
    });

    await e.next();
    expect(results).toEqual([1]);
  });

  it("chain built via setNextFunc wraps properly", async () => {
    // This mirrors the chain-building logic in Hook.trigger
    const e = new Event();
    const results: number[] = [];

    // Handler 2 (registered second, executes first due to stack-style building)
    const oldNext2 = e.nextFunc(); // null
    e.setNextFunc(() => {
      e.setNextFunc(oldNext2);
      results.push(2);
      return Promise.resolve();
    });

    // Handler 1 (registered first, wraps around handler 2)
    const oldNext1 = e.nextFunc(); // handler 2's func
    e.setNextFunc(() => {
      e.setNextFunc(oldNext1);
      results.push(1);
      return e.next(); // continues to handler 2
    });

    await e.next();
    expect(results).toEqual([1, 2]);
  });

  it("nextFunc and setNextFunc are symmetric", () => {
    const e = new Event();
    const fn = () => Promise.resolve("ok");
    expect(e.nextFunc()).toBeNull();
    e.setNextFunc(fn);
    expect(e.nextFunc()).toBe(fn as () => Promise<unknown>);
  });
});
