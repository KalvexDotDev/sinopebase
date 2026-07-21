import { describe, it, expect } from "bun:test";
import { parseIndex, buildIndex, isValidIndex, findSingleColumnUniqueIndex, hasSingleColumnUniqueIndex } from "./index";

describe("parseIndex", () => {
  it("parses a simple CREATE INDEX statement", () => {
    const result = parseIndex('CREATE INDEX idx_users_email ON "users" ("email")');
    expect(result.indexName).toBe("idx_users_email");
    expect(result.tableName).toBe("users");
    expect(result.unique).toBe(false);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0]!.name).toBe("email");
  });

  it("parses a UNIQUE INDEX", () => {
    const result = parseIndex('CREATE UNIQUE INDEX idx_unique_email ON "users" ("email")');
    expect(result.unique).toBe(true);
    expect(result.indexName).toBe("idx_unique_email");
  });

  it("parses IF NOT EXISTS", () => {
    const result = parseIndex('CREATE INDEX IF NOT EXISTS idx_name ON "products" ("name")');
    expect(result.optional).toBe(true);
  });

  it("parses multi-column index", () => {
    const result = parseIndex('CREATE INDEX idx_name_cat ON "products" ("name", "category")');
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0]!.name).toBe("name");
    expect(result.columns[1]!.name).toBe("category");
  });

  it("parses index with DESC sort", () => {
    const result = parseIndex('CREATE INDEX idx_date ON "orders" ("created" DESC)');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0]!.name).toBe("created");
    expect(result.columns[0]!.sort).toBe("DESC");
  });

  it("parses index with WHERE clause", () => {
    const result = parseIndex('CREATE INDEX idx_active ON "users" ("status") WHERE status = 1');
    expect(result.where).toBe("status = 1");
  });

  it("parses schema-qualified index and table name", () => {
    const result = parseIndex('CREATE INDEX "public"."idx_name" ON "public"."users" ("name")');
    expect(result.schemaName).toBe("public");
    expect(result.indexName).toBe("idx_name");
    expect(result.tableName).toBe("users");
  });

  it("returns empty struct for invalid input", () => {
    const result = parseIndex("SELECT 1");
    expect(result.indexName).toBe("");
    expect(result.tableName).toBe("");
    expect(result.columns).toHaveLength(0);
  });
});

describe("isValidIndex", () => {
  it("returns true for valid index", () => {
    expect(isValidIndex({
      schemaName: "",
      indexName: "idx",
      tableName: "tbl",
      where: "",
      columns: [{ name: "col", collate: "", sort: "" }],
      unique: false,
      optional: false,
    })).toBe(true);
  });

  it("returns false when missing index name", () => {
    expect(isValidIndex({
      schemaName: "",
      indexName: "",
      tableName: "tbl",
      where: "",
      columns: [{ name: "col", collate: "", sort: "" }],
      unique: false,
      optional: false,
    })).toBe(false);
  });

  it("returns false when no columns", () => {
    expect(isValidIndex({
      schemaName: "",
      indexName: "idx",
      tableName: "tbl",
      where: "",
      columns: [],
      unique: false,
      optional: false,
    })).toBe(false);
  });
});

describe("buildIndex", () => {
  it("builds simple CREATE INDEX SQL", () => {
    const sql = buildIndex({
      schemaName: "",
      indexName: "idx_email",
      tableName: "users",
      where: "",
      columns: [{ name: "email", collate: "", sort: "" }],
      unique: false,
      optional: false,
    });
    expect(sql).toContain('CREATE INDEX');
    expect(sql).toContain('"idx_email"');
    expect(sql).toContain('"users"');
    expect(sql).toContain('"email"');
  });

  it("builds UNIQUE INDEX", () => {
    const sql = buildIndex({
      schemaName: "",
      indexName: "idx_unique",
      tableName: "tbl",
      where: "",
      columns: [{ name: "col", collate: "", sort: "DESC" }],
      unique: true,
      optional: false,
    });
    expect(sql).toContain("CREATE UNIQUE INDEX");
    expect(sql).toContain("DESC");
  });

  it("returns empty for invalid index", () => {
    expect(buildIndex({
      schemaName: "",
      indexName: "",
      tableName: "",
      where: "",
      columns: [],
      unique: false,
      optional: false,
    })).toBe("");
  });
});

describe("findSingleColumnUniqueIndex", () => {
  it("finds matching unique index", () => {
    const indexes = [
      'CREATE INDEX idx_name ON "products" ("name")',
      'CREATE UNIQUE INDEX idx_sku ON "products" ("sku")',
    ];
    const { index, found } = findSingleColumnUniqueIndex(indexes, "sku");
    expect(found).toBe(true);
    expect(index.indexName).toBe("idx_sku");
  });

  it("returns not found when no match", () => {
    const indexes = [
      'CREATE INDEX idx_name ON "products" ("name")',
    ];
    const { found } = findSingleColumnUniqueIndex(indexes, "sku");
    expect(found).toBe(false);
  });
});

describe("hasSingleColumnUniqueIndex", () => {
  it("returns true when unique index exists", () => {
    const indexes = [
      'CREATE UNIQUE INDEX idx_email ON "users" ("email")',
    ];
    expect(hasSingleColumnUniqueIndex("email", indexes)).toBe(true);
  });

  it("returns false when only non-unique index exists", () => {
    const indexes = [
      'CREATE INDEX idx_email ON "users" ("email")',
    ];
    expect(hasSingleColumnUniqueIndex("email", indexes)).toBe(false);
  });
});
