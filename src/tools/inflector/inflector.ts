/**
 * Port of PocketBase tools/inflector/inflector.go
 *
 * String inflection utilities.
 * Layer 0 -- zero internal dependencies.
 */

// ---------------------------------------------------------------------------
// UcFirst
// ---------------------------------------------------------------------------

/**
 * Converts the first character of a string to uppercase.
 *
 * @example
 *   UcFirst("hello") // => "Hello"
 */
export function UcFirst(str: string): string {
  if (str === "") {
    return "";
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------------------------------------------------------------------------
// Columnify
// ---------------------------------------------------------------------------

// Matches any character that is NOT a valid DB identifier character:
// word chars (\w), dots, asterisks, hyphens, underscores, @, #
const columnifyRemoveRegex = /[^\w.*\-_@#]+/g;

/**
 * Strips characters that are invalid in database identifiers.
 *
 * @example
 *   Columnify("col@@umn!name") // => "col@@umnname"
 */
export function Columnify(str: string): string {
  return str.replace(columnifyRemoveRegex, "");
}

// ---------------------------------------------------------------------------
// Sentenize
// ---------------------------------------------------------------------------

/**
 * Normalizes a string into a sentence: trims whitespace, capitalises the
 * first letter, and appends a period if none of `.?!` ends the string.
 *
 * @example
 *   Sentenize("  hello world  ") // => "Hello world."
 */
export function Sentenize(str: string): string {
  str = str.trim();
  if (str === "") {
    return "";
  }
  str = UcFirst(str);
  if (!str.endsWith(".") && !str.endsWith("?") && !str.endsWith("!")) {
    return str + ".";
  }
  return str;
}

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

/**
 * Removes all characters matching `removePattern` from `str`.
 *
 * Throws if `removePattern` is not a valid regular expression.
 *
 * @example
 *   Sanitize("a1b2c3", "\\d") // => "abc"
 */
export function Sanitize(str: string, removePattern: string): string {
  try {
    const re = new RegExp(removePattern, "g");
    return str.replace(re, "");
  } catch {
    throw new Error(`Sanitize: invalid regex pattern "${removePattern}"`);
  }
}

// ---------------------------------------------------------------------------
// Snakecase
// ---------------------------------------------------------------------------

/**
 * Splits at non-word characters and underscores, inserts underscores at
 * camelCase boundaries, and lowercases the result.
 * Consecutive uppercase letters (abbreviations) are kept together.
 *
 * @example
 *   Snakecase("myTestDB")  // => "my_test_db"
 *   Snakecase("SendEmail") // => "send_email"
 */
export function Snakecase(str: string): string {
  // Split at any non-word character and underscore.
  const words = str.split(/[\W_]+/);

  const parts: string[] = [];

  for (const word of words) {
    if (word === "") {
      continue;
    }

    let part = "";
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]!;
      if (
        ch >= "A" &&
        ch <= "Z" &&
        i > 0 &&
        // Previous character is NOT uppercase (camelCase boundary)
        !(word[i - 1]! >= "A" && word[i - 1]! <= "Z")
      ) {
        part += "_";
      }
      part += ch;
    }
    parts.push(part);
  }

  return parts.join("_").toLowerCase();
}

// ---------------------------------------------------------------------------
// Camelize
// ---------------------------------------------------------------------------

/**
 * Converts the provided string to its CamelCased version.
 * Non-alphanumeric characters are removed and the next character is
 * uppercased.
 *
 * @example
 *   Camelize("send_email") // => "SendEmail"
 */
export function Camelize(str: string): string {
  let result = "";
  let isPrevSpecial = false;

  for (const ch of str) {
    if (!isAlphanumeric(ch)) {
      isPrevSpecial = true;
      continue;
    }

    if (isPrevSpecial || result.length === 0) {
      isPrevSpecial = false;
      result += ch.toUpperCase();
    } else {
      result += ch;
    }
  }

  return result;
}

function isAlphanumeric(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}
