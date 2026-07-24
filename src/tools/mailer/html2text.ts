/**
 * HTML to plain text converter for email bodies.
 *
 * Port of PocketBase tools/mailer/html2text.go
 * Layer 1 -- zero external dependencies (pure TypeScript).
 *
 * Caveats:
 * - Does not validate HTML correctness.
 * - Links are converted to "[text](url)" format.
 * - List items (`<li>`) are prefixed with "- ".
 * - Multiple consecutive newlines are collapsed unless multiple `<br>` tags are used.
 * - Indentation is collapsed (tabs and leading spaces).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tags whose content should be completely skipped. */
const TAGS_TO_SKIP = new Set([
  "style",
  "script",
  "iframe",
  "applet",
  "object",
  "svg",
  "img",
  "button",
  "form",
  "textarea",
  "input",
  "select",
  "option",
  "template",
  "head",
  "noscript",
]);

/** Inline-level HTML tags (no automatic newline before/after). */
const INLINE_TAGS = new Set([
  "a",
  "span",
  "small",
  "strike",
  "strong",
  "sub",
  "sup",
  "em",
  "b",
  "u",
  "i",
  "abbr",
  "acronym",
  "bdo",
  "big",
  "br",
  "button",
  "cite",
  "code",
  "label",
  "q",
  "time",
]);


// ---------------------------------------------------------------------------
// Token types for the HTML tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: "text"; value: string }
  | { type: "opentag"; tag: string; attrs: Record<string, string> }
  | { type: "closetag"; tag: string }
  | { type: "selfclose"; tag: string; attrs: Record<string, string> }
  | { type: "comment" }
  | { type: "doctype" };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * A rudimentary HTML tokenizer.
 *
 * Produces tokens for text content, open/close tags, self-closing tags,
 * comments, and doctype declarations.
 */
function* tokenize(html: string): Generator<Token> {
  let i = 0;

  while (i < html.length) {
    // Check for tag start
    if (html[i] === "<") {
      // Comment: <!-- ... -->
      if (
        html.startsWith("<!--", i)
      ) {
        const end = html.indexOf("-->", i + 4);
        i = end !== -1 ? end + 3 : html.length;
        yield { type: "comment" };
        continue;
      }

      // Doctype: <!DOCTYPE ... >
      if (html[i + 1] === "!") {
        const end = html.indexOf(">", i);
        i = end !== -1 ? end + 1 : html.length;
        yield { type: "doctype" };
        continue;
      }

      // Closing tag: </tagname>
      if (html[i + 1] === "/") {
        const end = html.indexOf(">", i);
        if (end === -1) {
          i = html.length;
          break;
        }
        const tag = html.slice(i + 2, end).trim().split(/\s+/)[0]!.toLowerCase();
        i = end + 1;
        if (tag !== "") {
          yield { type: "closetag", tag };
        }
        continue;
      }

      // Opening or self-closing tag: <tagname ...> or <tagname ... />
      const end = html.indexOf(">", i);
      if (end === -1) {
        i = html.length;
        break;
      }

      const tagContent = html.slice(i + 1, end).trim();

      // Self-closing: <br/> or <img ... />
      const isSelfClose = tagContent.endsWith("/");
      const cleanContent = isSelfClose
        ? tagContent.slice(0, -1).trim()
        : tagContent;

      const spaceIdx = cleanContent.search(/[\s/>]/);
      let tagName: string;
      let attrsStr: string;

      if (spaceIdx === -1) {
        tagName = cleanContent.toLowerCase();
        attrsStr = "";
      } else {
        tagName = cleanContent.slice(0, spaceIdx).toLowerCase();
        attrsStr = cleanContent.slice(spaceIdx + 1).trim();
      }

      const attrs = parseAttributes(attrsStr);

      if (isSelfClose || isSelfClosingTag(tagName)) {
        yield { type: "selfclose", tag: tagName, attrs };
      } else {
        yield { type: "opentag", tag: tagName, attrs };
      }

      i = end + 1;
      continue;
    }

    // Text content
    let text = "";
    while (i < html.length && html[i] !== "<") {
      text += html[i]!;
      i++;
    }
    if (text !== "") {
      yield { type: "text", value: text };
    }
  }
}

/**
 * Parse a simple attribute string into a key-value map.
 */
function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Match attribute="value" or attribute='value' or attribute
  const attrRegex = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrsStr)) !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = value;
  }
  return attrs;
}

/**
 * Returns true if the tag is self-closing in HTML spec.
 */
const SELF_CLOSING_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function isSelfClosingTag(tag: string): boolean {
  return SELF_CLOSING_TAGS.has(tag);
}

// ---------------------------------------------------------------------------
// html2Text
// ---------------------------------------------------------------------------

/**
 * Very rudimentary auto HTML to Text mail body converter.
 *
 * Converts HTML to plain text by stripping tags, converting links to
 * `[text](url)` format, and inserting newlines at block boundaries.
 */
export function html2Text(htmlDocument: string): string {
  const output: string[] = [];
  let canAddNewLine = true;

  // Stack of active builders — when inside an <a> tag we use a separate builder
  // to capture the link label text.
  interface LinkContext {
    builder: string[];
    attrs: Record<string, string>;
  }
  const linkStack: LinkContext[] = [];

  // Track the tag hierarchy to skip content inside excluded tags
  const skipDepth: number[] = [];
  let inSkip = 0;

  for (const token of tokenize(htmlDocument)) {
    if (token.type === "opentag" || token.type === "selfclose") {
      const tag = token.tag;

      // Track skip depth
      if (token.type === "opentag" && TAGS_TO_SKIP.has(tag)) {
        skipDepth.push(1);
        inSkip++;
        continue;
      }

      if (inSkip > 0) {
        continue;
      }

      if (token.type === "opentag" && tag === "a") {
        // Start a link context
        linkStack.push({ builder: [], attrs: token.attrs });
      }

      if (token.type === "opentag" && tag === "li") {
        output.push("- ");
      }

      if (tag === "br") {
        output.push("\r\n");
        canAddNewLine = false;
      } else if (
        canAddNewLine &&
        !INLINE_TAGS.has(tag) &&
        token.type === "opentag"
      ) {
        output.push("\r\n");
        canAddNewLine = false;
      }
    }

    if (token.type === "closetag" && linkStack.length > 0 && token.tag === "a") {
      // Close the link context
      const ctx = linkStack.pop()!;
      const linkText = ctx.builder.join("").trim();
      const href = ctx.attrs["href"] ?? "";

      if (linkText !== "") {
        output.push(`[${linkText}]`);
      } else {
        output.push("[LINK]");
      }

      if (href !== "") {
        output.push(`(${href})`);
      }

      canAddNewLine = true;
      continue;
    }

    if (token.type === "closetag") {
      // Track skip depth exit
      if (TAGS_TO_SKIP.has(token.tag) && skipDepth.length > 0) {
        skipDepth.pop();
        inSkip--;
        continue;
      }

      if (inSkip > 0) {
        continue;
      }

      if (
        canAddNewLine &&
        !INLINE_TAGS.has(token.tag)
      ) {
        output.push("\r\n");
        canAddNewLine = false;
      }
    }

    if (token.type === "selfclose" && inSkip > 0) {
      continue;
    }

    if (token.type === "text" && inSkip === 0) {
      let txt = token.value.replace(/\s+/g, " ");

      // Trim leading spaces if we just had a newline
      if (!canAddNewLine) {
        txt = txt.replace(/^ +/, "");
      }

      if (txt !== "") {
        // If inside a link, append to the link builder
        if (linkStack.length > 0) {
          linkStack[linkStack.length - 1]!.builder.push(txt);
        } else {
          output.push(txt);
        }
        canAddNewLine = true;
      }
    }
  }

  // Collapse multiple consecutive newlines into one, but preserve
  // \r\n sequences from <br> tags.
  let result = output.join("");

  // Collapse 3+ consecutive newlines (separated only by whitespace) into double newline
  result = result.replace(/(\r?\n)[ \t]*(\r?\n)[ \t]*(\r?\n)+/g, "$1$2");

  return result.trim();
}
