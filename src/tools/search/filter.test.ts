import { describe, it, expect, beforeEach } from "bun:test";
import {
  buildFilterExpr,
  buildFilterExprRaw,
  clearFilterCache,
  parseFilterParam,
  parseOrFilters,
  parseInValue,
} from "./filter";
import { SimpleFieldResolver, NullFallbackPreference } from "./simple_field_resolver";

beforeEach(() => {
  clearFilterCache();
});

// ---------------------------------------------------------------------------
// Simple test resolver
// ---------------------------------------------------------------------------

const simpleResolver = new SimpleFieldResolver(["id", "name", "email", "status", "created", "total", "category"]);

function build(sql: string): { sql: string; values: unknown[] } {
  return buildFilterExpr(sql, simpleResolver);
}

// ---------------------------------------------------------------------------
// Filter expression tests
// ---------------------------------------------------------------------------

describe("buildFilterExpr", () => {
  it("parses basic equality: id = 'test'", () => {
    const result = build("id = 'test'");
    expect(result.sql).toContain("=");
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBe("test");
  });

  it("parses numeric comparison: total >= 100", () => {
    const result = build("total >= 100");
    expect(result.sql).toContain(">=");
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBe(100);
  });

  it("parses null check: status = null", () => {
    const result = build("status = null");
    // Should produce a null comparison
    expect(result.sql).toBeString();
  });

  it("parses boolean: status = true", () => {
    const result = build("status = true");
    expect(result.sql).toContain("=");
  });

  it("parses AND expression: name = 'test' && status = true", () => {
    const result = build("name = 'test' && status = true");
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBe("test");
  });

  it("parses OR expression: name = 'a' || name = 'b'", () => {
    const result = build("name = 'a' || name = 'b'");
    expect(result.values).toHaveLength(2);
    expect(result.values).toContain("a");
    expect(result.values).toContain("b");
  });

  it("parses parenthesized groups: (id = 'a' || id = 'b') && status = true", () => {
    const result = build("(id = 'a' || id = 'b') && status = true");
    expect(result.sql).toContain("AND");
    // 'a', 'b' are parameterized; 'true' is a normalized identifier (resolved to '1')
    expect(result.values).toHaveLength(2);
    expect(result.values).toContain("a");
    expect(result.values).toContain("b");
  });

  it("parses LIKE: name ~ 'test'", () => {
    const result = build("name ~ 'test'");
    expect(result.sql).toContain("LIKE");
    expect(result.values).toHaveLength(1);
  });

  it("parses NOT LIKE: name !~ 'test'", () => {
    const result = build("name !~ 'test'");
    expect(result.sql).toContain("NOT LIKE");
  });

  it("parses less than: total < 50", () => {
    const result = build("total < 50");
    expect(result.sql).toContain("<");
    expect(result.values[0]).toBe(50);
  });

  it("parses greater than: total > 100", () => {
    const result = build("total > 100");
    expect(result.sql).toContain(">");
    expect(result.values[0]).toBe(100);
  });

  it("parses less than or equal: total <= 50", () => {
    const result = build("total <= 50");
    expect(result.sql).toContain("<=");
  });

  it("parses greater than or equal: total >= 100", () => {
    const result = build("total >= 100");
    expect(result.sql).toContain(">=");
  });

  it("replaces {:param} placeholders", () => {
    const result = buildFilterExpr(
      "id = {:userId}",
      simpleResolver,
      { userId: "abc123" },
    );
    // The placeholder is replaced inline with a quoted value then parsed as a text literal
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBe("abc123");
  });
});

describe("buildFilterExprRaw", () => {
  it("returns named params in result", () => {
    const result = buildFilterExprRaw("name = 'hello'", simpleResolver);
    expect(result.params).toBeDefined();
    expect(Object.keys(result.params).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseFilterParam (existing API)
// ---------------------------------------------------------------------------

describe("parseFilterParam", () => {
  it("parses eq filter", () => {
    const result = parseFilterParam("id", "eq.123");
    expect(result).toEqual({ column: "id", operator: "eq", value: "123" });
  });

  it("parses like filter", () => {
    const result = parseFilterParam("name", "like.%hello%");
    expect(result).toEqual({ column: "name", operator: "like", value: "%hello%" });
  });

  it("returns null for non-filter keys", () => {
    expect(parseFilterParam("select", "*")).toBeNull();
    expect(parseFilterParam("order", "name")).toBeNull();
    expect(parseFilterParam("or", "id.eq.1")).toBeNull();
  });

  it("returns null if no dot operator", () => {
    expect(parseFilterParam("id", "123")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseOrFilters
// ---------------------------------------------------------------------------

describe("parseOrFilters", () => {
  it("parses OR filter group", () => {
    const result = parseOrFilters("(id.eq.1,status.eq.active)");
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(result[0]![0]!).toEqual({ column: "id", operator: "eq", value: "1" });
    expect(result[0]![1]!).toEqual({ column: "status", operator: "eq", value: "active" });
  });
});

// ---------------------------------------------------------------------------
// parseInValue
// ---------------------------------------------------------------------------

describe("parseInValue", () => {
  it("parses parenthesized list", () => {
    expect(parseInValue("(a,b,c)")).toEqual(["a", "b", "c"]);
  });

  it("handles empty list", () => {
    expect(parseInValue("()")).toEqual([]);
  });
});
