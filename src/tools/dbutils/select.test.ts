import { describe, it, expect } from "bun:test";
import { aliasOrIdentifier } from "./select";

describe("aliasOrIdentifier", () => {
  it("returns alias from AS syntax", () => {
    expect(aliasOrIdentifier("users AS u")).toBe("u");
    expect(aliasOrIdentifier("COUNT(*) AS cnt")).toBe("cnt");
    expect(aliasOrIdentifier("MAX(created) AS max_created")).toBe("max_created");
  });

  it("returns alias from implicit syntax", () => {
    expect(aliasOrIdentifier("users u")).toBe("u");
    expect(aliasOrIdentifier("orders o")).toBe("o");
  });

  it("returns identifier when no alias", () => {
    expect(aliasOrIdentifier("users")).toBe("users");
    expect(aliasOrIdentifier("id")).toBe("id");
    expect(aliasOrIdentifier("COUNT(*)")).toBe("COUNT(*)");
  });

  it("handles complex expressions", () => {
    expect(aliasOrIdentifier("DISTINCT id AS user_id")).toBe("user_id");
    expect(aliasOrIdentifier("jsonb_extract(data, '$.name') AS name")).toBe("name");
  });
});
