import { describe, it, expect } from "bun:test";
import { Message, addressToStrings } from "./mailer.ts";

describe("Message", () => {
  it("creates a message with default values", () => {
    const m = new Message();
    expect(m.from).toEqual({ name: "", address: "" });
    expect(m.to).toEqual([]);
    expect(m.subject).toBe("");
    expect(m.html).toBe("");
    expect(m.text).toBe("");
  });

  it("allows setting properties", () => {
    const m = new Message();
    m.from = { name: "Alice", address: "alice@example.com" };
    m.to = [{ name: "Bob", address: "bob@example.com" }];
    m.subject = "Hello";
    m.html = "<p>Hi</p>";
    expect(m.from.name).toBe("Alice");
    expect(m.to[0]?.address).toBe("bob@example.com");
  });
});

describe("addressToStrings", () => {
  it("returns bare email when withName is false", () => {
    const result = addressToStrings(
      [{ name: "Alice", address: "alice@example.com" }],
      false,
    );
    expect(result).toEqual(["alice@example.com"]);
  });

  it("returns formatted name+email when withName is true", () => {
    const result = addressToStrings(
      [{ name: "Alice", address: "alice@example.com" }],
      true,
    );
    expect(result[0]).toContain("Alice");
    expect(result[0]).toContain("alice@example.com");
  });

  it("handles empty address list", () => {
    expect(addressToStrings([], true)).toEqual([]);
  });

  it("handles multiple addresses", () => {
    const result = addressToStrings(
      [
        { name: "A", address: "a@x.com" },
        { name: "B", address: "b@x.com" },
      ],
      false,
    );
    expect(result).toEqual(["a@x.com", "b@x.com"]);
  });
});
