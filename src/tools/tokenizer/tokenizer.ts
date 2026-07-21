/**
 * Port of PocketBase tools/tokenizer/tokenizer.go
 *
 * Rudimentary string tokenizer that respects quote and parenthesis
 * boundaries, escape sequences, and configurable separator runes.
 * Layer 0 -- zero internal dependencies.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default separator characters (comma).
 */
const DEFAULT_SEPARATORS: string[] = [","];

/**
 * Unicode whitespace characters (matching Go's unicode.IsSpace
 * plus U+0085 / U+00A0).
 */
const WHITESPACE_CHARS = new Set([
  "\t", // U+0009
  "\n", // U+000A
  "\v", // U+000B
  "\f", // U+000C
  "\r", // U+000D
  " ", // U+0020
  "", // NEL
  " ", // NBSP
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * A string tokenizer that splits input on configurable separators while
 * respecting:
 *   - Single (`'`), double (`"`), and backtick (`` ` ``) quoted strings
 *   - Parenthesis nesting `( ... )`
 *   - Backslash escapes for quotes and parentheses
 *
 * @example
 *   // Quick static API
 *   const tokens = Tokenizer.Tokenize("a, b, (c, d)");
 *   // => ["a", "b", "(c, d)"]
 *
 * @example
 *   // Full class API
 *   const tk = new Tokenizer(`"hello world", 42`);
 *   tk.Scan(); // => "hello world"
 *   tk.Scan(); // => "42"
 */
export class Tokenizer {
  private readonly input: string;
  private pos: number;
  private separators: string[];
  private keepSeparator = false;
  private keepEmptyTokens = false;
  private ignoreParenthesis = false;

  // Cached set of whitespace characters that are NOT separators
  // (used for trimming tokens).
  private trimCutset: Set<string>;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Creates a new Tokenizer for `input` with the default comma separator.
   */
  constructor(input: string) {
    this.input = input;
    this.pos = 0;
    this.separators = [...DEFAULT_SEPARATORS];
    this.trimCutset = this.buildTrimCutset();
  }

  // -----------------------------------------------------------------------
  // Configuration setters
  // -----------------------------------------------------------------------

  /**
   * Sets the separator characters. Rebuilds the trim cutset accordingly.
   */
  SetSeparators(...separators: string[]): void {
    this.separators = separators;
    this.trimCutset = this.buildTrimCutset();
  }

  /**
   * When true, the separator character is kept as part of the token
   * (default: false).
   */
  SetKeepSeparator(state: boolean): void {
    this.keepSeparator = state;
  }

  /**
   * When true, empty tokens are included in results (default: false).
   */
  SetKeepEmptyTokens(state: boolean): void {
    this.keepEmptyTokens = state;
  }

  /**
   * When true, `(` and `)` are treated as regular characters instead of
   * grouping delimiters (default: false).
   */
  SetIgnoreParenthesis(state: boolean): void {
    this.ignoreParenthesis = state;
  }

  // -----------------------------------------------------------------------
  // Scan / ScanAll
  // -----------------------------------------------------------------------

  /**
   * Reads and returns the next token from the input.
   *
   * Returns `null` when the end of input has been reached (EOF).
   *
   * Empty tokens are skipped unless {@link SetKeepEmptyTokens} was set
   * to `true`.
   */
  Scan(): string | null {
    if (this.pos >= this.input.length) {
      return null;
    }

    const token = this.readToken();

    if (!this.keepEmptyTokens && token === "") {
      return this.Scan();
    }

    return token;
  }

  /**
   * Reads the entire input and returns all tokens.
   */
  ScanAll(): string[] {
    const tokens: string[] = [];
    let token: string | null;
    while ((token = this.Scan()) !== null) {
      tokens.push(token);
    }
    return tokens;
  }

  // -----------------------------------------------------------------------
  // Static convenience API
  // -----------------------------------------------------------------------

  /**
   * Convenience static method that tokenizes a string in one call.
   *
   * @param input - The string to tokenize.
   * @param separators - Separator characters (default: `[","]`).
   *
   * @example
   *   Tokenizer.Tokenize("a, b, (c, d)")
   *   // => ["a", "b", "(c, d)"]
   */
  static Tokenize(input: string, separators: string[] = DEFAULT_SEPARATORS): string[] {
    const tk = new Tokenizer(input);
    tk.SetSeparators(...separators);
    return tk.ScanAll();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Reads a single token from the current position.
   */
  private readToken(): string {
    let result = "";
    let parenthesis = 0;
    let quoteCh: string | null = null;
    let prevCh: string | null = null;

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]!;

      // Escape prevents the next character from being treated as a
      // quote/parenthesis delimiter (the backslash itself is preserved
      // in the output).
      const isEscaped = prevCh === "\\";

      if (!isEscaped) {
        if (!this.ignoreParenthesis && ch === "(" && quoteCh === null) {
          parenthesis++;
        } else if (
          !this.ignoreParenthesis &&
          ch === ")" &&
          parenthesis > 0 &&
          quoteCh === null
        ) {
          parenthesis--;
        } else if (isQuoteRune(ch)) {
          if (quoteCh === ch) {
            quoteCh = null; // closing quote
          } else if (quoteCh === null) {
            quoteCh = ch; // opening quote
          }
        }
      }

      // Separator check – always performed regardless of escape status
      // (matches the Go behaviour where separators are NOT escapable).
      if (this.isSeparator(ch) && parenthesis === 0 && quoteCh === null) {
        this.pos++;
        if (this.keepSeparator) {
          result += ch;
        }
        break;
      }

      prevCh = ch;
      result += ch;
      this.pos++;
    }

    if (parenthesis > 0 || quoteCh !== null) {
      throw new Error(
        `Unbalanced parenthesis or quoted expression: "${result}"`,
      );
    }

    // Trim whitespace that is not a separator from both ends.
    result = this.trimToken(result);

    return result;
  }

  /**
   * Returns true if `ch` is one of the configured separator characters.
   */
  private isSeparator(ch: string): boolean {
    return this.separators.includes(ch);
  }

  /**
   * Builds the set of whitespace characters that are NOT configured
   * as separators.  These characters will be trimmed from tokens.
   */
  private buildTrimCutset(): Set<string> {
    const s = new Set(WHITESPACE_CHARS);
    for (const sep of this.separators) {
      s.delete(sep);
    }
    return s;
  }

  /**
   * Strips leading and trailing characters that are in `trimCutset`.
   */
  private trimToken(token: string): string {
    let start = 0;
    while (start < token.length && this.trimCutset.has(token[start]!)) {
      start++;
    }
    let end = token.length - 1;
    while (end >= start && this.trimCutset.has(token[end]!)) {
      end--;
    }
    return token.slice(start, end + 1);
  }
}

// ---------------------------------------------------------------------------
// Module-level helper
// ---------------------------------------------------------------------------

function isQuoteRune(ch: string): boolean {
  return ch === "'" || ch === '"' || ch === "`";
}
