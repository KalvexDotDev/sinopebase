import { describe, it, expect } from "bun:test";
import { Render } from '~/tools/template/renderer';
import { Registry } from '~/tools/template/registry';

// ---------------------------------------------------------------------------
// Render (renderer.ts)
// ---------------------------------------------------------------------------

describe("Render", () => {
  it("replaces a single {{var}} placeholder", () => {
    expect(Render("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("replaces multiple placeholders", () => {
    expect(Render("{{a}} {{b}}", { a: "foo", b: "bar" })).toBe("foo bar");
  });

  it("keeps placeholder when key is missing in data", () => {
    expect(Render("Hello {{name}}!", {})).toBe("Hello {{name}}!");
  });

  it("coerces numbers to strings", () => {
    expect(Render("Age: {{age}}", { age: 30 })).toBe("Age: 30");
  });

  it("coerces booleans to strings", () => {
    expect(Render("Flag: {{flag}}", { flag: true })).toBe("Flag: true");
  });

  it("renders null or undefined as empty string", () => {
    expect(Render("{{a}}-{{b}}", { a: null, b: undefined })).toBe("-");
  });

  it("handles empty template string", () => {
    expect(Render("", {})).toBe("");
  });

  it("handles template with no placeholders", () => {
    expect(Render("static text", { x: "y" })).toBe("static text");
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("Registry", () => {
  it("registers and renders a template function", () => {
    const reg = new Registry();
    reg.Register("greet", (data) => `Hello ${data.name ?? "World"}!`);
    expect(reg.Render("greet", { name: "Jane" })).toBe("Hello Jane!");
  });

  it("renders with default values", () => {
    const reg = new Registry();
    reg.Register("greet", (data) => `Hello ${data.name ?? "World"}!`);
    expect(reg.Render("greet", {})).toBe("Hello World!");
  });

  it("replaces an existing template function", () => {
    const reg = new Registry();
    reg.Register("tpl", () => "old");
    reg.Register("tpl", () => "new");
    expect(reg.Render("tpl", {})).toBe("new");
  });

  it("Get returns undefined for unregistered name", () => {
    const reg = new Registry();
    expect(reg.Get("nonexistent")).toBeUndefined();
  });

  it("Get returns the registered function", () => {
    const reg = new Registry();
    const fn = () => "hello";
    reg.Register("tpl", fn);
    expect(reg.Get("tpl")).toBe(fn);
  });

  it("throws on Render of unregistered name", () => {
    const reg = new Registry();
    expect(() => reg.Render("missing", {})).toThrow(
      'Template "missing" not found',
    );
  });

  it("works independently for separate registry instances", () => {
    const reg1 = new Registry();
    const reg2 = new Registry();
    reg1.Register("a", () => "from reg1");
    reg2.Register("a", () => "from reg2");
    expect(reg1.Render("a", {})).toBe("from reg1");
    expect(reg2.Render("a", {})).toBe("from reg2");
  });
});
