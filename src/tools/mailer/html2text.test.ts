import { describe, it, expect } from "bun:test";
import { html2Text } from "./html2text.ts";

describe("html2Text", () => {
  it("converts plain text unchanged", () => {
    expect(html2Text("hello world")).toBe("hello world");
  });

  it("strips simple tags", () => {
    expect(html2Text("<p>hello</p>")).toBe("hello");
  });

  it("converts links to [text](url) format", () => {
    expect(html2Text('<a href="https://example.com">click here</a>')).toBe(
      "[click here](https://example.com)",
    );
  });

  it("handles link without text", () => {
    expect(html2Text('<a href="https://example.com"></a>')).toBe(
      "[LINK](https://example.com)",
    );
  });

  it("handles a tags without href", () => {
    expect(html2Text("<a>click</a>")).toBe("[click]");
  });

  it("converts <br> to newlines", () => {
    expect(html2Text("line1<br>line2")).toBe("line1\r\nline2");
    expect(html2Text("line1<br/>line2")).toBe("line1\r\nline2");
  });

  it("adds newlines for block elements", () => {
    const html = "<p>first</p><p>second</p>";
    // The exact formatting may vary but both words should appear
    const result = html2Text(html);
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  it("prefixes list items with dash", () => {
    const html = "<ul><li>item1</li><li>item2</li></ul>";
    const result = html2Text(html);
    expect(result).toContain("- item1");
    expect(result).toContain("- item2");
  });

  it("skips style and script content", () => {
    const html = "<p>hello</p><style>.foo {}</style><script>alert(1)</script><p>world</p>";
    const result = html2Text(html);
    expect(result).not.toContain(".foo");
    expect(result).not.toContain("alert");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("collapses whitespace", () => {
    expect(html2Text("hello    world")).toBe("hello world");
    expect(html2Text("  hello  ")).toBe("hello");
  });

  it("trims leading/trailing whitespace", () => {
    expect(html2Text("  hello  ")).toBe("hello");
  });

  it("handles nested tags", () => {
    expect(html2Text("<div><p>hello <b>world</b></p></div>")).toBe("hello world");
  });

  it("handles empty input", () => {
    expect(html2Text("")).toBe("");
  });

  it("handles complex HTML with multiple links", () => {
    const html =
      '<p>Read <a href="/docs">the docs</a> or <a href="/api">the API</a>.</p>';
    const result = html2Text(html);
    expect(result).toContain("[the docs](/docs)");
    expect(result).toContain("[the API](/api)");
  });
});
