import { describe, it, expect } from "bun:test";
import { Tokenizer } from '~/tools/tokenizer/tokenizer';

// ---------------------------------------------------------------------------
// Static Tokenizer.Tokenize
// ---------------------------------------------------------------------------

describe("Tokenizer.Tokenize (static)", () => {
  it("splits comma-separated values", () => {
    expect(Tokenizer.Tokenize("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("handles parenthesis grouping", () => {
    expect(Tokenizer.Tokenize("a, (b, c), d")).toEqual(["a", "(b, c)", "d"]);
  });

  it("handles quoted strings (quotes preserved, matching Go behaviour)", () => {
    expect(Tokenizer.Tokenize('"hello, world", foo')).toEqual([
      '"hello, world"',
      "foo",
    ]);
  });

  it("handles custom separators", () => {
    expect(Tokenizer.Tokenize("a|b|c", ["|"])).toEqual(["a", "b", "c"]);
  });

  it("handles empty input", () => {
    expect(Tokenizer.Tokenize("")).toEqual([]);
  });

  it("skips empty tokens by default", () => {
    expect(Tokenizer.Tokenize("a,,b")).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Tokenizer class: Scan / ScanAll
// ---------------------------------------------------------------------------

describe("Tokenizer.Scan", () => {
  it("returns tokens one at a time", () => {
    const tk = new Tokenizer("a, b, c");
    expect(tk.Scan()).toBe("a");
    expect(tk.Scan()).toBe("b");
    expect(tk.Scan()).toBe("c");
    expect(tk.Scan()).toBeNull();
  });

  it("returns null (EOF) when exhausted", () => {
    const tk = new Tokenizer("");
    expect(tk.Scan()).toBeNull();
  });
});

describe("Tokenizer.ScanAll", () => {
  it("returns all tokens", () => {
    const tk = new Tokenizer("a, b, c");
    expect(tk.ScanAll()).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty input", () => {
    const tk = new Tokenizer("");
    expect(tk.ScanAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

describe("Tokenizer - quoted strings", () => {
  it("handles double-quoted strings containing separators", () => {
    const tk = new Tokenizer('"a,b", c');
    // Go preserves the quote characters in the output.
    expect(tk.ScanAll()).toEqual(['"a,b"', "c"]);
  });

  it("handles single-quoted strings", () => {
    const tk = new Tokenizer("'a,b', c");
    expect(tk.ScanAll()).toEqual(["'a,b'", "c"]);
  });

  it("handles backtick-quoted strings", () => {
    const tk = new Tokenizer("`a,b`, c");
    expect(tk.ScanAll()).toEqual(["`a,b`", "c"]);
  });

  it("throws on unclosed quote", () => {
    const tk = new Tokenizer('"unclosed');
    expect(() => tk.ScanAll()).toThrow(/unbalanced/i);
  });
});

// ---------------------------------------------------------------------------
// Parenthesis
// ---------------------------------------------------------------------------

describe("Tokenizer - parenthesis", () => {
  it("keeps grouped content as single token", () => {
    const tk = new Tokenizer("(a, b, c), d");
    expect(tk.ScanAll()).toEqual(["(a, b, c)", "d"]);
  });

  it("handles nested parentheses", () => {
    const tk = new Tokenizer("(a, (b, c)), d");
    expect(tk.ScanAll()).toEqual(["(a, (b, c))", "d"]);
  });

  it("throws on unbalanced opening paren", () => {
    const tk = new Tokenizer("(a, b");
    expect(() => tk.ScanAll()).toThrow(/unbalanced/i);
  });

  it("treats extra closing paren as regular character (matching Go behaviour)", () => {
    const tk = new Tokenizer("a, b)");
    // Go only tracks paren when parenthesis > 0, so an unmatched ')' is
    // treated as a regular character.
    expect(tk.ScanAll()).toEqual(["a", "b)"]);
  });

  it("ignores parenthesis when ignoreParenthesis is true", () => {
    const tk = new Tokenizer("(a, b), c");
    tk.SetIgnoreParenthesis(true);
    expect(tk.ScanAll()).toEqual(["(a", "b)", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Escape
// ---------------------------------------------------------------------------

describe("Tokenizer - escape sequences", () => {
  it("prevents quote from being treated as delimiter", () => {
    const tk = new Tokenizer('a\\"b, c');
    expect(tk.ScanAll()).toEqual(['a\\"b', "c"]);
  });

  it("preserves backslash in output", () => {
    const tk = new Tokenizer("a\\\\, b");
    // The \\ is not treated as escape for the separator (separators are
    // never escaped), so the ',' after a\\\\ is a separator.
    // Actually: input "a\\\\, b" - let me trace:
    // a, \, \, then comma
    expect(tk.ScanAll()).toEqual(["a\\\\", "b"]);
  });
});

// ---------------------------------------------------------------------------
// KeepSeparator
// ---------------------------------------------------------------------------

describe("Tokenizer - keepSeparator", () => {
  it("keeps separator as part of token when enabled", () => {
    const tk = new Tokenizer("a, b");
    tk.SetKeepSeparator(true);
    expect(tk.ScanAll()).toEqual(["a,", "b"]);
  });
});

// ---------------------------------------------------------------------------
// KeepEmptyTokens
// ---------------------------------------------------------------------------

describe("Tokenizer - keepEmptyTokens", () => {
  it("skips empty tokens by default", () => {
    const tk = new Tokenizer("a,,b");
    expect(tk.ScanAll()).toEqual(["a", "b"]);
  });

  it("includes empty tokens when enabled", () => {
    const tk = new Tokenizer("a,,b");
    tk.SetKeepEmptyTokens(true);
    expect(tk.ScanAll()).toEqual(["a", "", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Custom separators
// ---------------------------------------------------------------------------

describe("Tokenizer - custom separators", () => {
  it("tokenizes with pipe separator", () => {
    const tk = new Tokenizer("a|b|c");
    tk.SetSeparators("|");
    expect(tk.ScanAll()).toEqual(["a", "b", "c"]);
  });

  it("tokenizes with semicolon separator", () => {
    const tk = new Tokenizer("a; b; c");
    tk.SetSeparators(";");
    expect(tk.ScanAll()).toEqual(["a", "b", "c"]);
  });

  it("handles multiple separator characters", () => {
    const tk = new Tokenizer("a,b;c");
    tk.SetSeparators(",", ";");
    expect(tk.ScanAll()).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

describe("Tokenizer - whitespace", () => {
  it("trims whitespace around tokens", () => {
    const tk = new Tokenizer("  a  ,  b  ");
    expect(tk.ScanAll()).toEqual(["a", "b"]);
  });

  it("handles newlines", () => {
    const tk = new Tokenizer("a\n,\nb");
    expect(tk.ScanAll()).toEqual(["a", "b"]);
  });
});
