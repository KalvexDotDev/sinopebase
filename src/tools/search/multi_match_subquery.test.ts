import { describe, it, expect } from "bun:test";
import { MultiMatchSubQuery } from "./multi_match_subquery";

describe("MultiMatchSubQuery", () => {
  it("builds a basic subquery", () => {
    const sq = new MultiMatchSubQuery({
      targetTableAlias: "t",
      fromTableName: "rel_table",
      fromTableAlias: "r",
      valueIdentifier: "r.name",
    });

    const sql = sq.build();
    expect(sql).toContain('SELECT r.name AS "multiMatchValue"');
    expect(sql).toContain('FROM "rel_table" "r"');
    expect(sql).toContain('WHERE "r"."id" = "t"."id"');
  });

  it("returns 0=1 when missing required config", () => {
    const sq = new MultiMatchSubQuery({
      targetTableAlias: "t",
      fromTableName: "",
      fromTableAlias: "",
    });

    expect(sq.build()).toBe("0=1");
  });

  it("includes JOINs when specified", () => {
    const sq = new MultiMatchSubQuery({
      targetTableAlias: "t",
      fromTableName: "orgs",
      fromTableAlias: "o",
      valueIdentifier: "o.name",
      joins: [
        { tableName: "users", tableAlias: "u", on: '"u"."org_id" = "o"."id"' },
      ],
    });

    const sql = sq.build();
    expect(sql).toContain('LEFT JOIN "users" "u"');
    expect(sql).toContain('ON "u"."org_id" = "o"."id"');
  });

  it("merges params when provided", () => {
    const sq = new MultiMatchSubQuery({
      targetTableAlias: "t",
      fromTableName: "items",
      fromTableAlias: "i",
      valueIdentifier: "i.val",
      params: { p1: "v1" },
    });

    const externalParams: Record<string, unknown> = {};
    sq.build(externalParams);

    expect(externalParams.p1).toBe("v1");
  });
});
