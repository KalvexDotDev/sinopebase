import { describe, it, expect } from "bun:test";
import { Provider, DEFAULT_PER_PAGE, MAX_PER_PAGE } from "./provider";
import { SimpleFieldResolver } from "./simple_field_resolver";
import type { FilterData } from "./filter";

describe("Provider", () => {
  const resolver = new SimpleFieldResolver(["id", "name", "status", "created"]);

  it("creates with defaults", () => {
    const p = new Provider(resolver);
    expect(p.page).toBe(1);
    expect(p.perPage).toBe(DEFAULT_PER_PAGE);
    expect(p.filter).toEqual([]);
    expect(p.sort).toEqual([]);
    expect(p.skipTotal).toBe(false);
  });

  it("parses URL query parameters", () => {
    const p = new Provider(resolver);
    p.parse("page=2&perPage=50&sort=-created&filter=status='active'");

    expect(p.page).toBe(2);
    expect(p.perPage).toBe(50);
    expect(p.sort).toHaveLength(1);
    expect(p.sort[0]!.name).toBe("created");
    expect(p.sort[0]!.direction).toBe("DESC");
    expect(p.filter).toHaveLength(1);
    expect(p.filter[0]).toBe("status='active'");
  });

  it("parses skipTotal parameter", () => {
    const p = new Provider(resolver);
    p.parse("skipTotal=true");
    expect(p.skipTotal).toBe(true);
  });

  it("normalizes page to minimum 1", () => {
    const p = new Provider(resolver);
    p.setPage(0);
    // Normalization happens during exec
    expect(p.page).toBe(0);

    p.setPage(-5);
    expect(p.page).toBe(-5);
  });

  it("normalizes perPage within valid range", () => {
    const p = new Provider(resolver);
    p.setPerPage(0);
    // Normalization happens during exec
    expect(p.perPage).toBe(0);

    p.setPerPage(2000);
    // Normalization happens during exec
    expect(p.perPage).toBe(2000);
  });

  it("buildWhere generates SQL from filters", () => {
    const p = new Provider(resolver);
    p.addFilter("name = 'test'");

    const where = p.buildWhere();
    expect(where.sql).toBeTruthy();
    expect(where.params).toHaveLength(1);
    expect(where.params[0]).toBe("test");
  });

  it("buildWhere with multiple filters joins with AND", () => {
    const p = new Provider(resolver);
    p.addFilter("name = 'test'");
    p.addFilter("status = true");

    const where = p.buildWhere();
    expect(where.sql).toContain("AND");
  });

  it("buildOrderBy generates sort expressions", () => {
    const p = new Provider(resolver);
    p.addSort({ name: "name", direction: "ASC" });
    p.addSort({ name: "created", direction: "DESC" });

    const orderBy = p.buildOrderBy();
    expect(orderBy).toHaveLength(2);
  });

  it("buildOrderBy enforces sort expression limit", () => {
    const p = new Provider(resolver);
    p.maxSortExprLimit = 2;
    p.addSort({ name: "a", direction: "ASC" });
    p.addSort({ name: "b", direction: "ASC" });
    p.addSort({ name: "c", direction: "ASC" });
    p.addSort({ name: "d", direction: "ASC" });

    expect(() => p.buildOrderBy()).toThrow("max sort expressions limit reached");
  });

  it("buildOrderBy enforces sort field length limit", () => {
    const p = new Provider(resolver);
    p.addSort({ name: "x".repeat(256), direction: "ASC" });

    expect(() => p.buildOrderBy()).toThrow("max sort field length limit reached");
  });

  it("exec throws EmptyQueryError when query not set", async () => {
    const p = new Provider(resolver);
    await expect(
      p.exec(
        async () => [],
        async () => 0,
      ),
    ).rejects.toThrow("search query is not set");
  });

  it("exec calls execModels with correct limit/offset", async () => {
    const p = new Provider(resolver);
    p.setQuery("base_query");
    p.setPage(2);
    p.setPerPage(20);

    let capturedLimit = 0;
    let capturedOffset = 0;

    const result = await p.exec<{ id: string }>(
      async (_where, _orderBy, limit, offset) => {
        capturedLimit = limit;
        capturedOffset = offset;
        return [{ id: "1" }, { id: "2" }];
      },
      async (_where) => {
        return 50;
      },
    );

    expect(capturedLimit).toBe(20);
    expect(capturedOffset).toBe(20); // (page-1) * perPage = 1 * 20 = 20
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(20);
    expect(result.totalItems).toBe(50);
    expect(result.totalPages).toBe(3); // ceil(50/20) = 3
    expect(result.items).toHaveLength(2);
  });

  it("exec with skipTotal skips count query", async () => {
    const p = new Provider(resolver);
    p.setQuery("base_query");
    p.setSkipTotal(true);

    let countCalled = false;

    const result = await p.exec<{ id: string }>(
      async () => [{ id: "1" }],
      async (_where) => {
        countCalled = true;
        return 100;
      },
    );

    expect(countCalled).toBe(false);
    expect(result.totalItems).toBe(-1);
    expect(result.totalPages).toBe(-1);
  });

  it("parseAndExec combines parse and exec", async () => {
    const p = new Provider(resolver);
    p.query = "base_query";

    const result = await p.parseAndExec<{ id: string }>(
      "filter=name='hello'&perPage=5",
      async (where, _orderBy, limit, _offset) => {
        expect(where.sql).toBeTruthy();
        expect(limit).toBe(5);
        return [{ id: "hello" }];
      },
      async () => 10,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe("hello");
    expect(result.perPage).toBe(5);
  });
});
