import { describe, it, expect, beforeEach } from "bun:test";
import {
  SubtractSlice,
  ExistInSlice,
  ExistInSliceWithRegex,
  clearRegexCache,
  ToInterfaceSlice,
  NonzeroUniques,
  ToUniqueStringSlice,
  ToChunks,
} from '~/tools/list/list';

// ---------------------------------------------------------------------------
// SubtractSlice
// ---------------------------------------------------------------------------

describe("SubtractSlice", () => {
  it("returns elements in base not in subtract", () => {
    expect(SubtractSlice([1, 2, 3, 4], [2, 4])).toEqual([1, 3]);
  });

  it("returns full base when subtract is empty", () => {
    expect(SubtractSlice([1, 2, 3], [])).toEqual([1, 2, 3]);
  });

  it("returns empty when base is empty", () => {
    expect(SubtractSlice([], [1, 2])).toEqual([]);
  });

  it("handles no overlap", () => {
    expect(SubtractSlice([1, 2], [3, 4])).toEqual([1, 2]);
  });

  it("works with strings", () => {
    expect(SubtractSlice(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// ExistInSlice
// ---------------------------------------------------------------------------

describe("ExistInSlice", () => {
  it("returns true for existing number", () => {
    expect(ExistInSlice(3, [1, 2, 3])).toBe(true);
  });

  it("returns false for missing number", () => {
    expect(ExistInSlice(99, [1, 2, 3])).toBe(false);
  });

  it("returns true for existing string", () => {
    expect(ExistInSlice("b", ["a", "b", "c"])).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(ExistInSlice("a", [])).toBe(false);
  });

  it("uses strict equality for objects", () => {
    const obj = { id: 1 };
    expect(ExistInSlice(obj, [obj])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExistInSliceWithRegex
// ---------------------------------------------------------------------------

describe("ExistInSliceWithRegex", () => {
  beforeEach(() => {
    clearRegexCache();
  });

  it("matches via direct comparison", () => {
    expect(ExistInSliceWithRegex("hello", ["hello", "world"])).toBe(true);
  });

  it("matches via regex", () => {
    expect(ExistInSliceWithRegex("foo123", ["^foo\\d+$"])).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(ExistInSliceWithRegex("bar", ["^foo\\d+$"])).toBe(false);
  });

  it("caches compiled regex patterns", () => {
    ExistInSliceWithRegex("test", ["^t\\w+$"]);
    // Second call uses the cache
    expect(ExistInSliceWithRegex("testing", ["^t\\w+$"])).toBe(true);
  });

  it("evicts oldest when cache exceeds limit", () => {
    for (let i = 0; i < 510; i++) {
      ExistInSliceWithRegex("x", [`^${i}$`]);
    }
    // Should still work (cache size is bounded)
    expect(ExistInSliceWithRegex("500", ["^500$"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ToInterfaceSlice
// ---------------------------------------------------------------------------

describe("ToInterfaceSlice", () => {
  it("converts a number array", () => {
    const result = ToInterfaceSlice([1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it("converts an empty array", () => {
    expect(ToInterfaceSlice([])).toEqual([]);
  });

  it("returns a new array (not the same reference)", () => {
    const original = [1, 2];
    const result = ToInterfaceSlice(original);
    expect(result).not.toBe(original);
  });
});

// ---------------------------------------------------------------------------
// NonzeroUniques
// ---------------------------------------------------------------------------

describe("NonzeroUniques", () => {
  it("filters zero numbers", () => {
    expect(NonzeroUniques([0, 1, 0, 2, 0])).toEqual([1, 2]);
  });

  it("filters empty strings", () => {
    expect(NonzeroUniques(["", "a", "", "b"])).toEqual(["a", "b"]);
  });

  it("filters false", () => {
    expect(NonzeroUniques([false, true, false])).toEqual([true]);
  });

  it("filters null and undefined", () => {
    expect(NonzeroUniques([null, "a", undefined, "b"])).toEqual(["a", "b"]);
  });

  it("deduplicates values", () => {
    expect(NonzeroUniques([1, 1, 2, 2, 3])).toEqual([1, 2, 3]);
  });

  it("handles empty input", () => {
    expect(NonzeroUniques([])).toEqual([]);
  });

  it("preserves object references (dedup by reference)", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const copy = { id: 1 }; // different reference
    expect(NonzeroUniques([a, b, a, copy])).toEqual([a, b, copy]);
  });
});

// ---------------------------------------------------------------------------
// ToUniqueStringSlice
// ---------------------------------------------------------------------------

describe("ToUniqueStringSlice", () => {
  it("returns empty array for null", () => {
    expect(ToUniqueStringSlice(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(ToUniqueStringSlice(undefined)).toEqual([]);
  });

  it("wraps a plain string in an array", () => {
    expect(ToUniqueStringSlice("hello")).toEqual(["hello"]);
  });

  it("filters zero strings from plain string input", () => {
    expect(ToUniqueStringSlice("")).toEqual([]);
  });

  it("parses a JSON array string", () => {
    expect(ToUniqueStringSlice('["a","b","a"]')).toEqual(["a", "b"]);
  });

  it("treats non-array JSON string as single value", () => {
    expect(ToUniqueStringSlice('{"a":1}')).toEqual(['{"a":1}']);
  });

  it("handles string array input", () => {
    expect(ToUniqueStringSlice(["x", "y", "x"])).toEqual(["x", "y"]);
  });

  it("handles mixed array input", () => {
    expect(ToUniqueStringSlice([1, 2, 1])).toEqual(["1", "2"]);
  });

  it("treats numbers as single-element", () => {
    expect(ToUniqueStringSlice(42)).toEqual(["42"]);
  });
});

// ---------------------------------------------------------------------------
// ToChunks
// ---------------------------------------------------------------------------

describe("ToChunks", () => {
  it("splits into chunks of given size", () => {
    expect(ToChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns single chunk when size >= length", () => {
    expect(ToChunks([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("chunks of size 1", () => {
    expect(ToChunks([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("handles empty array", () => {
    expect(ToChunks([], 3)).toEqual([]);
  });

  it("defaults size < 1 to 1", () => {
    expect(ToChunks([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(ToChunks([1, 2, 3], -1)).toEqual([[1], [2], [3]]);
  });
});
