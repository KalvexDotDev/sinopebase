import { describe, it, expect } from "bun:test";
import { Hook, Event } from "./hook.ts";

class TestEvent extends Event {
  readonly id: string

  constructor(id: string) {
    super()
    this.id = id
  }
}

describe("Hook", () => {
  it("starts with zero handlers", () => {
    const h = new Hook<TestEvent>();
    expect(h.length).toBe(0);
  });

  it("bindFunc adds a handler", () => {
    const h = new Hook<TestEvent>();
    h.bindFunc(async () => Promise.resolve());
    expect(h.length).toBe(1);
  });

  it("trigger invokes all handlers", async () => {
    const h = new Hook<TestEvent>();
    const results: string[] = [];

    h.bindFunc(async (e) => {
      results.push("A:" + e.id);
      return e.next();
    });
    h.bindFunc(async (e) => {
      results.push("B:" + e.id);
      return e.next();
    });

    await h.trigger(new TestEvent("x"));
    expect(results).toEqual(["A:x", "B:x"]);
  });

  it("handlers without next() stop the chain", async () => {
    const h = new Hook<TestEvent>();
    const results: string[] = [];

    h.bindFunc(async (e) => {
      results.push("first");
      return e.next();
    });
    h.bindFunc(async () => {
      results.push("second");
      // intentionally NOT calling e.next()
    });
    h.bindFunc(async () => {
      results.push("third");
      return Promise.resolve();
    });

    await h.trigger(new TestEvent("x"));
    expect(results).toEqual(["first", "second"]);
  });

  it("executes handlers in priority order", async () => {
    const h = new Hook<TestEvent>();
    const results: number[] = [];

    h.bind({ func: async (e) => { results.push(3); return e.next(); }, id: "", priority: 10 });
    h.bind({ func: async (e) => { results.push(1); return e.next(); }, id: "", priority: 0 });
    h.bind({ func: async (e) => { results.push(2); return e.next(); }, id: "", priority: 5 });

    await h.trigger(new TestEvent("x"));
    expect(results).toEqual([1, 2, 3]);
  });

  it("bind replaces handler with same id", () => {
    const h = new Hook<TestEvent>();

    const id = h.bind({ func: async () => { return Promise.resolve(); }, id: "my-handler", priority: 0 });
    expect(id).toBe("my-handler");
    expect(h.length).toBe(1);

    // Replace
    h.bind({ func: async () => { return Promise.resolve(); }, id: "my-handler", priority: 0 });
    expect(h.length).toBe(1); // still 1 – replaced, not added
  });

  it("bind auto-generates id when empty", () => {
    const h = new Hook<TestEvent>();
    const id1 = h.bindFunc(async () => Promise.resolve());
    const id2 = h.bindFunc(async () => Promise.resolve());
    expect(id1).not.toBe("");
    expect(id2).not.toBe("");
    expect(id1).not.toBe(id2);
  });

  it("unbind removes a handler by id", () => {
    const h = new Hook<TestEvent>();
    const id = h.bindFunc(async () => Promise.resolve());
    expect(h.length).toBe(1);
    h.unbind(id);
    expect(h.length).toBe(0);
  });

  it("unbindAll removes all handlers", () => {
    const h = new Hook<TestEvent>();
    h.bindFunc(async () => Promise.resolve());
    h.bindFunc(async () => Promise.resolve());
    h.bindFunc(async () => Promise.resolve());
    expect(h.length).toBe(3);
    h.unbindAll();
    expect(h.length).toBe(0);
  });

  it("one-off handlers are called after registered handlers", async () => {
    const h = new Hook<TestEvent>();
    const results: string[] = [];

    h.bindFunc(async (e) => {
      results.push("registered:" + e.id);
      return e.next();
    });

    await h.trigger(
      new TestEvent("x"),
      async (e) => { results.push("oneoff:" + e.id); return e.next(); },
    );

    expect(results).toEqual(["registered:x", "oneoff:x"]);
  });

  it("multiple one-off handlers work", async () => {
    const h = new Hook<TestEvent>();
    const results: string[] = [];

    await h.trigger(
      new TestEvent("x"),
      async (e) => { results.push("o1:" + e.id); return e.next(); },
      async (e) => { results.push("o2:" + e.id); return e.next(); },
    );

    expect(results).toEqual(["o1:x", "o2:x"]);
  });

  it("trigger can be called multiple times", async () => {
    const h = new Hook<TestEvent>();
    let count = 0;

    h.bindFunc(async (e) => { count++; return e.next(); });

    await h.trigger(new TestEvent("a"));
    await h.trigger(new TestEvent("b"));
    expect(count).toBe(2);
  });
});
