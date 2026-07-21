import { describe, it, expect } from "bun:test";
import {
  UcFirst,
  Columnify,
  Sentenize,
  Sanitize,
  Snakecase,
  Camelize,
} from '~/tools/inflector/inflector';

// ---------------------------------------------------------------------------
// UcFirst
// ---------------------------------------------------------------------------

describe("UcFirst", () => {
  it("capitalizes the first letter", () => {
    expect(UcFirst("hello")).toBe("Hello");
  });

  it("returns empty string for empty input", () => {
    expect(UcFirst("")).toBe("");
  });

  it("handles single character", () => {
    expect(UcFirst("a")).toBe("A");
  });

  it("does not change already capitalized strings", () => {
    expect(UcFirst("Hello")).toBe("Hello");
  });
});

// ---------------------------------------------------------------------------
// Columnify
// ---------------------------------------------------------------------------

describe("Columnify", () => {
  it("strips invalid characters", () => {
    // '!' and whitespace are invalid
    expect(Columnify("col@@  umn!name")).toBe("col@@umnname");
  });

  it("keeps valid characters", () => {
    expect(Columnify("col_umn-1*")).toBe("col_umn-1*");
  });

  it("handles empty string", () => {
    expect(Columnify("")).toBe("");
  });

  it("keeps @ and # characters", () => {
    expect(Columnify("@user#tag")).toBe("@user#tag");
  });
});

// ---------------------------------------------------------------------------
// Sentenize
// ---------------------------------------------------------------------------

describe("Sentenize", () => {
  it("trims and capitalizes, appending period", () => {
    expect(Sentenize("  hello world  ")).toBe("Hello world.");
  });

  it("does not append period when string already ends with punctuation", () => {
    expect(Sentenize("hello world.")).toBe("Hello world.");
    expect(Sentenize("hello world?")).toBe("Hello world?");
    expect(Sentenize("hello world!")).toBe("Hello world!");
  });

  it("returns empty for empty string", () => {
    expect(Sentenize("")).toBe("");
  });

  it("returns empty for whitespace-only string", () => {
    expect(Sentenize("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

describe("Sanitize", () => {
  it("removes characters matching the pattern", () => {
    expect(Sanitize("a1b2c3", "\\d")).toBe("abc");
  });

  it("returns original string when pattern has no matches", () => {
    expect(Sanitize("hello", "\\d")).toBe("hello");
  });

  it("throws on invalid regex", () => {
    expect(() => Sanitize("hello", "[invalid")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Snakecase
// ---------------------------------------------------------------------------

describe("Snakecase", () => {
  it("converts camelCase", () => {
    expect(Snakecase("myTestDB")).toBe("my_test_db");
  });

  it("converts PascalCase", () => {
    expect(Snakecase("SendEmail")).toBe("send_email");
  });

  it("splits at non-word characters", () => {
    expect(Snakecase("hello world")).toBe("hello_world");
    expect(Snakecase("hello-world")).toBe("hello_world");
    expect(Snakecase("hello_world")).toBe("hello_world");
  });

  it("preserves abbreviations (consecutive uppercase)", () => {
    // Go behaviour: consecutive uppercase chars are kept together
    // (no underscore inserted between them).
    expect(Snakecase("myTestDB")).toBe("my_test_db");
  });

  it("handles empty string", () => {
    expect(Snakecase("")).toBe("");
  });

  it("lowercases the result", () => {
    expect(Snakecase("HELLO")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Camelize
// ---------------------------------------------------------------------------

describe("Camelize", () => {
  it("converts snake_case to CamelCase", () => {
    expect(Camelize("send_email")).toBe("SendEmail");
  });

  it("handles multiple separators", () => {
    expect(Camelize("hello-world_foo")).toBe("HelloWorldFoo");
  });

  it("removes non-alphanumeric characters", () => {
    expect(Camelize("hello @world!")).toBe("HelloWorld");
  });

  it("handles empty string", () => {
    expect(Camelize("")).toBe("");
  });

  it("handles single word", () => {
    expect(Camelize("hello")).toBe("Hello");
  });

  it("preserves digits", () => {
    expect(Camelize("user_2_name")).toBe("User2Name");
  });
});
