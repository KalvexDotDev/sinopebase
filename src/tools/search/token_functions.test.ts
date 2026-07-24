import { describe, it, expect } from "bun:test";
import { tokenFunctions, concatUniqueParams } from "./token_functions";
import { NullFallbackPreference } from "./simple_field_resolver";

describe("tokenFunctions", () => {
  describe("geoDistance", () => {
    it("returns Error with wrong number of args", () => {
      const result = tokenFunctions["geoDistance"]!(
        () => ({ identifier: "1", params: {} }),
        // Only 1 arg instead of 4
        { type: "number", literal: "1" },
      );
      expect(result instanceof Error).toBe(true);
      if (result instanceof Error) {
        expect(result.message).toContain("expected 4 arguments");
      }
    });

    it("returns Error for invalid arg types", () => {
      const result = tokenFunctions["geoDistance"]!(
        () => ({ identifier: "x", params: {} }),
        { type: "text", literal: "hello" },
        { type: "number", literal: "1" },
        { type: "number", literal: "2" },
        { type: "number", literal: "3" },
      );
      expect(result instanceof Error).toBe(true);
    });

    it("builds Haversine formula with 4 numeric args", () => {
      const result = tokenFunctions["geoDistance"]!(
        (t) => ({ identifier: t.literal, params: {} }),
        { type: "number", literal: "1" },
        { type: "number", literal: "2" },
        { type: "number", literal: "3" },
        { type: "number", literal: "4" },
      );
      expect(result instanceof Error).toBe(false);
      if (!(result instanceof Error)) {
        expect(result.identifier).toContain("6371");
        expect(result.identifier).toContain("acos");
        expect(result.identifier).toContain("radians");
      }
    });

    it("uses NullFallbackDisabled", () => {
      const result = tokenFunctions["geoDistance"]!(
        (t) => ({ identifier: t.literal, params: {} }),
        { type: "number", literal: "1" },
        { type: "number", literal: "2" },
        { type: "number", literal: "3" },
        { type: "number", literal: "4" },
      );
      if (!(result instanceof Error)) {
        expect(result.nullFallback).toBe(NullFallbackPreference.Disabled);
      }
    });
  });

  describe("strftime", () => {
    it("returns Error with no args", () => {
      const result = tokenFunctions["strftime"]!(
        () => ({ identifier: "", params: {} }),
      );
      expect(result instanceof Error).toBe(true);
    });

    it("returns Error if first arg is not text", () => {
      const result = tokenFunctions["strftime"]!(
        () => ({ identifier: "", params: {} }),
        { type: "identifier", literal: "name" },
      );
      expect(result instanceof Error).toBe(true);
    });

    it("builds to_char expression with format only", () => {
      const result = tokenFunctions["strftime"]!(
        () => ({ identifier: "'%Y'", params: {} }),
        { type: "text", literal: "%Y" },
      );
      expect(result instanceof Error).toBe(false);
      if (!(result instanceof Error)) {
        expect(result.identifier).toContain("to_char");
      }
    });
  });

  describe("concatUniqueParams", () => {
    it("merges non-conflicting params", () => {
      const dest = { a: 1 };
      concatUniqueParams(dest, { b: 2 });
      expect(dest as Record<string, number>).toEqual({ a: 1, b: 2 });
    });

    it("throws on conflicting param values", () => {
      const dest = { x: 1 };
      expect(() => concatUniqueParams(dest, { x: 2 })).toThrow("conflicting param key x");
    });

    it("allows same key same value", () => {
      const dest = { x: 1 };
      expect(() => concatUniqueParams(dest, { x: 1 })).not.toThrow();
    });
  });
});
