import { describe, it, expect } from "bun:test";
import { jsonEach, jsonArrayLength, jsonExtract, jsonExtractObject } from "./json";

describe("jsonEach", () => {
  it("generates jsonb_array_elements expression", () => {
    const result = jsonEach("data");
    expect(result).toContain("jsonb_array_elements");
    expect(result).toContain("[[data]]");
    expect(result).toContain("jsonb_typeof");
    expect(result).toContain("jsonb_build_array");
  });
});

describe("jsonArrayLength", () => {
  it("generates jsonb_array_length expression", () => {
    const result = jsonArrayLength("tags");
    expect(result).toContain("jsonb_array_length");
    expect(result).toContain("[[tags]]");
  });
});

describe("jsonExtract", () => {
  it("extracts root value with empty path", () => {
    const result = jsonExtract("data", "");
    expect(result).toContain("[[data]]::text");
  });

  it("extracts simple key path", () => {
    const result = jsonExtract("data", "name");
    expect(result).toContain("->>");
    expect(result).toContain("'name'");
    expect(result).toContain("[[data]]");
  });

  it("extracts nested path", () => {
    const result = jsonExtract("data", "address.city");
    expect(result).toContain("->'address'");
    expect(result).toContain("->>'city'");
  });

  it("extracts array index path", () => {
    const result = jsonExtract("data", "0");
    expect(result).toContain("->>0");
  });
});

describe("jsonExtractObject", () => {
  it("returns column for empty path", () => {
    expect(jsonExtractObject("data", "")).toBe("[[data]]");
  });

  it("builds -> chain for nested path", () => {
    const result = jsonExtractObject("meta", "settings.theme");
    expect(result).toContain("[[meta]]");
    expect(result).toContain("->'settings'");
    expect(result).toContain("->'theme'");
  });

  it("handles array indices", () => {
    const result = jsonExtractObject("items", "0.name");
    expect(result).toContain("->0");
    expect(result).toContain("->'name'");
  });
});
