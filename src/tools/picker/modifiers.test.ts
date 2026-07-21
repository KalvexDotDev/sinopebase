import { describe, it, expect } from "bun:test";
import { Modifiers, initModifier } from "./modifiers.ts";

describe("initModifier", () => {
  it("throws for empty modifier expression", () => {
    expect(() => initModifier("")).toThrow();
  });

  it("throws for unknown modifier name", () => {
    expect(() => initModifier("nonexistent")).toThrow(
      /missing or invalid modifier/,
    );
  });
});

describe("Modifiers registry", () => {
  it("allows registering custom modifiers", () => {
    Modifiers["uppercase"] = () => ({
      modify(value: unknown): unknown {
        if (typeof value === "string") return value.toUpperCase();
        return value;
      },
    });

    const mod = initModifier("uppercase");
    expect(mod.modify("hello")).toBe("HELLO");
    expect(mod.modify(42)).toBe(42);

    // Clean up
    delete Modifiers["uppercase"];
  });

  it("allows modifiers with arguments", () => {
    Modifiers["repeat"] = (...args: string[]) => ({
      modify(value: unknown): unknown {
        if (typeof value === "string") {
          const times = Number(args[0]) || 1;
          return value.repeat(times);
        }
        return value;
      },
    });

    const mod = initModifier("repeat(3)");
    expect(mod.modify("ab")).toBe("ababab");

    // Clean up
    delete Modifiers["repeat"];
  });
});
