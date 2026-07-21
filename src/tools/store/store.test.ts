import { describe, it, expect } from "bun:test";
import { Store } from "./store.ts";

describe("Store", () => {
  it("creates an empty store", () => {
    const s = new Store<string, number>();
    expect(s.length).toBe(0);
  });

  it("creates a store from a Map", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2]]));
    expect(s.length).toBe(2);
    expect(s.get("a")).toBe(1);
  });

  it("set and get values", () => {
    const s = new Store<string, number>();
    s.set("key1", 42);
    expect(s.get("key1")).toBe(42);
  });

  it("get returns undefined for missing key", () => {
    const s = new Store<string, number>();
    expect(s.get("missing")).toBeUndefined();
  });

  it("has returns correct boolean", () => {
    const s = new Store<string, number>();
    expect(s.has("x")).toBe(false);
    s.set("x", 1);
    expect(s.has("x")).toBe(true);
  });

  it("getOk returns value and ok=true for existing key", () => {
    const s = new Store<string, number>();
    s.set("a", 10);
    const result = s.getOk("a");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(10);
  });

  it("getOk returns ok=false for missing key", () => {
    const s = new Store<string, number>();
    const result = s.getOk("missing");
    expect(result.ok).toBe(false);
  });

  it("remove deletes a key", () => {
    const s = new Store<string, number>();
    s.set("x", 1);
    s.remove("x");
    expect(s.has("x")).toBe(false);
    expect(s.length).toBe(0);
  });

  it("remove is a no-op for missing key", () => {
    const s = new Store<string, number>();
    s.set("x", 1);
    s.remove("nonexistent");
    expect(s.length).toBe(1);
  });

  it("removeAll clears the store", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2], ["c", 3]]));
    expect(s.length).toBe(3);
    s.removeAll();
    expect(s.length).toBe(0);
  });

  it("reset replaces all data", () => {
    const s = new Store<string, number>(new Map([["a", 1]]));
    s.reset(new Map([["b", 2]]));
    expect(s.length).toBe(1);
    expect(s.get("a")).toBeUndefined();
    expect(s.get("b")).toBe(2);
  });

  it("reset with null/undefined clears the store", () => {
    const s = new Store<string, number>(new Map([["a", 1]]));
    s.reset();
    expect(s.length).toBe(0);
  });

  it("getAll returns a shallow copy", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2]]));
    const all = s.getAll();
    expect(all.size).toBe(2);
    all.set("c", 3);
    // original store should be unchanged
    expect(s.length).toBe(2);
  });

  it("values returns all values", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2]]));
    const vals = s.values();
    expect(vals.sort()).toEqual([1, 2]);
  });

  it("setFunc computes new value from old", () => {
    const s = new Store<string, number>();
    s.setFunc("count", (old) => (old ?? 0) + 1);
    expect(s.get("count")).toBe(1);
    s.setFunc("count", (old) => (old ?? 0) + 1);
    expect(s.get("count")).toBe(2);
  });

  it("setFunc handles missing key", () => {
    const s = new Store<string, number>();
    s.setFunc("newKey", (old) => (old ?? 0) + 5);
    expect(s.get("newKey")).toBe(5);
  });

  it("getOrSet returns existing value", async () => {
    const s = new Store<string, number>(new Map([["x", 99]]));
    const v = await s.getOrSet("x", () => Promise.resolve(42));
    expect(v).toBe(99);
  });

  it("getOrSet stores and returns new value", async () => {
    const s = new Store<string, number>();
    const v = await s.getOrSet("x", () => Promise.resolve(42));
    expect(v).toBe(42);
    expect(s.get("x")).toBe(42);
  });

  it("getOrSet calls setFunc only once for concurrent access", async () => {
    const s = new Store<string, string>();
    let callCount = 0;
    const results = await Promise.all([
      s.getOrSet("key", async () => { callCount++; return "value"; }),
      s.getOrSet("key", async () => { callCount++; return "value"; }),
    ]);
    expect(results).toEqual(["value", "value"]);
    expect(callCount).toBe(1);
  });

  it("setIfLessThanLimit stores new entry when under limit", () => {
    const s = new Store<string, number>(new Map([["a", 1]]));
    const ok = s.setIfLessThanLimit("b", 2, 2);
    expect(ok).toBe(true);
    expect(s.length).toBe(2);
  });

  it("setIfLessThanLimit rejects new entry when at limit", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2]]));
    const ok = s.setIfLessThanLimit("c", 3, 2);
    expect(ok).toBe(false);
    expect(s.has("c")).toBe(false);
  });

  it("setIfLessThanLimit still overwrites existing at limit", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2]]));
    const ok = s.setIfLessThanLimit("a", 99, 2);
    expect(ok).toBe(true);
    expect(s.get("a")).toBe(99);
    expect(s.length).toBe(2);
  });

  it("supports numeric keys", () => {
    const s = new Store<number, string>();
    s.set(1, "one");
    s.set(2, "two");
    expect(s.get(1)).toBe("one");
    expect(s.get(2)).toBe("two");
    expect(s.length).toBe(2);
  });

  it("supports object keys", () => {
    const s = new Store<object, string>();
    const key1 = { id: 1 };
    const key2 = { id: 2 };
    s.set(key1, "first");
    s.set(key2, "second");
    expect(s.get(key1)).toBe("first");
    expect(s.get(key2)).toBe("second");
  });

  it("importJSON merges data", () => {
    const s = new Store<string, number>(new Map([["existing", 100]]));
    s.importJSON('{"newKey": 200}');
    expect(s.get("existing")).toBe(100);
    expect(s.get("newKey")).toBe(200);
  });

  it("exportJSON produces valid JSON", () => {
    const s = new Store<string, number>(new Map([["a", 1], ["b", 2]]));
    const json = s.exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });
});
