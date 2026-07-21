/**
 * Field picker: select specified fields from an object using dot-notation paths.
 *
 * Port of PocketBase tools/picker/pick.go
 * Layer 1 -- imports from Layer 0 tools.
 */

import { Tokenizer } from "~/tools/tokenizer/tokenizer.ts";
import { initModifier } from "./modifiers.ts";
import type { Modifier } from "./modifiers.ts";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FieldRule {
  /** Raw path as provided by the user (e.g. "a.b.c" or "-password"). */
  raw: string;
  /** True when this is an exclusion rule (starts with "-"). */
  exclude: boolean;
  /** Path minus the exclusion prefix. */
  path: string;
  /** Optional modifier to apply. */
  modifier: Modifier | null;
}

// ---------------------------------------------------------------------------
// Pick
// ---------------------------------------------------------------------------

/**
 * Selects only the specified fields from a data object.
 *
 * The `rawFields` parameter is a comma-separated string of field paths.
 * Nested fields use dot-notation (e.g. `"user.name"`).
 * Fields can include value modifiers using the `:modifier(args)` format.
 * Wildcard `*` selects all root-level fields, and exclusion is done with
 * the `-` prefix (e.g. `"*,-password"` drops the "password" field).
 *
 * The data is first serialized through JSON marshal/unmarshal to ensure
 * that any custom serialization logic is applied (matching Go behaviour).
 *
 * @example
 * ```ts
 *   const data = { a: 1, b: 2, c: { c1: 11, c2: 22 } };
 *   Pick(data, "a,c.c1");
 *   // => { a: 1, c: { c1: 11 } }
 * ```
 *
 * @example
 * ```ts
 *   const data = { a: 1, b: 2, c: 3 };
 *   Pick(data, "*,-b");
 *   // => { a: 1, c: 3 }
 * ```
 */
export function Pick(data: unknown, rawFields: string): unknown {
  const rules = parseFields(rawFields);

  // Deep-clone via JSON to invoke any custom serializers (matching Go behaviour)
  let decoded: unknown;
  try {
    const encoded = JSON.stringify(data);
    decoded = JSON.parse(encoded);
  } catch {
    decoded = data;
  }

  applyRules(decoded, rules);

  return decoded;
}

// ---------------------------------------------------------------------------
// parseFields
// ---------------------------------------------------------------------------

/**
 * Parses a raw field selection string into a list of field rules.
 *
 * Format:
 *   fields ::= field ("," field)*
 *   field  ::= "-"? path (":" modifier)?
 */
export function parseFields(rawFields: string): FieldRule[] {
  const rules: FieldRule[] = [];

  if (rawFields.trim() === "") {
    return rules;
  }

  const t = new Tokenizer(rawFields);
  const fields = t.ScanAll();

  for (const f of fields) {
    const trimmed = f.trim();
    if (trimmed === "") continue;

    const isExclusion = trimmed.startsWith("-");
    const fieldBody = isExclusion ? trimmed.slice(1) : trimmed;

    const colonIdx = fieldBody.indexOf(":");
    let path: string;
    let modifier: Modifier | null = null;

    if (colonIdx !== -1) {
      path = fieldBody.slice(0, colonIdx);
      const modStr = fieldBody.slice(colonIdx + 1);
      if (modStr !== "") {
        modifier = initModifier(modStr);
      }
    } else {
      path = fieldBody;
    }

    if (path === "") continue;

    rules.push({ raw: trimmed, exclude: isExclusion, path, modifier });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// applyRules
// ---------------------------------------------------------------------------

/**
 * Apply the parsed field rules to `data` in-place.
 */
function applyRules(data: unknown, rules: FieldRule[]): void {
  if (data === null || data === undefined || rules.length === 0) return;

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "object" && item !== null) {
        applyRulesToMap(item as Record<string, unknown>, rules);
      }
    }
  } else if (typeof data === "object") {
    applyRulesToMap(data as Record<string, unknown>, rules);
  }
}

// ---------------------------------------------------------------------------
// applyRulesToMap
// ---------------------------------------------------------------------------

/**
 * Apply field selection rules to a flat or nested map.
 *
 * Strategy:
 * 1. Separate rules into "includes" (normal paths + wildcard) and "excludes".
 * 2. If there's a wildcard, populate includes with all keys not already
 *    included or excluded.
 * 3. Build a per-key action plan from the combined include/exclude info.
 * 4. Apply the plan to each data key (keep, delete, or recurse).
 */
function applyRulesToMap(
  data: Record<string, unknown>,
  rules: FieldRule[],
): void {
  // Separate rule types
  const rootInclusions = new Map<string, { modifier: Modifier | null; remainder: string[] }>();
  const rootExclusions = new Set<string>();
  const exclusionSubPaths = new Map<string, string[]>();
  let hasWildcard = false;
  let wildcardMod: Modifier | null = null;

  for (const rule of rules) {
    if (rule.exclude) {
      // Exclusion
      const dotIdx = rule.path.indexOf(".");
      if (dotIdx === -1) {
        // Flat exclusion: the root key is excluded entirely
        rootExclusions.add(rule.path);
      } else {
        // Nested exclusion: only a sub-path is excluded; the root key may
        // still be included (e.g. by wildcard).  Track the sub-path for
        // when we recurse.
        const root = rule.path.slice(0, dotIdx);
        const remainder = rule.path.slice(dotIdx + 1);
        // Do NOT add to rootExclusions – that would delete the parent key.
        // Instead we only track it for recursion.
        const existing = exclusionSubPaths.get(root) ?? [];
        existing.push(remainder);
        exclusionSubPaths.set(root, existing);
      }
    } else if (rule.path === "*") {
      hasWildcard = true;
      wildcardMod = rule.modifier;
    } else {
      // Inclusion
      const dotIdx = rule.path.indexOf(".");
      if (dotIdx === -1) {
        rootInclusions.set(rule.path, { modifier: rule.modifier, remainder: [] });
      } else {
        const root = rule.path.slice(0, dotIdx);
        const remainder = rule.path.slice(dotIdx + 1);
        const existing = rootInclusions.get(root);
        if (existing) {
          existing.remainder.push(remainder);
        } else {
          rootInclusions.set(root, { modifier: null, remainder: [remainder] });
        }
      }
    }
  }

  // Wildcard expansion: add all root keys that aren't already included
  if (hasWildcard) {
    for (const key of Object.keys(data)) {
      if (!rootInclusions.has(key) && !rootExclusions.has(key)) {
        rootInclusions.set(key, { modifier: wildcardMod, remainder: [] });
      }
    }
  }

  // If no wildcard and no explicit inclusions, no fields to keep → delete everything
  // (But if only exclusions were specified, keep everything except those)
  if (!hasWildcard && rootInclusions.size === 0) {
    // Check if there were any explicit non-exclusion rules
    const hasNonWildcardInclusion = rules.some((r) => !r.exclude && r.path !== "*" && !r.path.startsWith("-"));
    if (!hasNonWildcardInclusion && rules.some((r) => r.exclude || r.path === "*")) {
      // Only exclusions/wildcard specified — keep all except those excluded
      for (const key of Object.keys(data)) {
        if (!rootExclusions.has(key)) {
          rootInclusions.set(key, { modifier: null, remainder: [] });
        }
      }
    }
  }

  // Process each data key
  for (const key of Object.keys(data)) {
    if (rootExclusions.has(key) && !rootInclusions.has(key)) {
      // Excluded and not re-included — delete
      delete data[key];
      continue;
    }

    const inclusion = rootInclusions.get(key);
    if (!inclusion) {
      // Not in inclusion set — delete
      delete data[key];
      continue;
    }

    // Apply modifier if this is a direct-field inclusion
    if (inclusion.remainder.length === 0 && inclusion.modifier) {
      data[key] = inclusion.modifier.modify(data[key]);
    }

    // Determine whether we need to recurse into this key:
    //   - When inclusion has sub-path remainders
    //   - When there are sub-exclusions for this key
    const hasRemainder = inclusion.remainder.length > 0;
    const hasSubExclusions = exclusionSubPaths.has(key);

    if (hasRemainder || hasSubExclusions) {
      const child = data[key];
      if (typeof child === "object" && child !== null) {
        // Build sub-rules
        const subRules: FieldRule[] = [];

        // If we have sub-exclusions but no inclusion remainders, the key was
        // included by wildcard — we need to pass a wildcard rule down so that
        // all sub-keys are kept (minus the exclusions).
        if (!hasRemainder && hasSubExclusions) {
          subRules.push({
            raw: "*",
            exclude: false,
            path: "*",
            modifier: null,
          });
        }

        for (const rem of inclusion.remainder) {
          subRules.push({
            raw: rem,
            exclude: false,
            path: rem,
            modifier: null,
          });
        }

        // Add sub-exclusions
        const subExclusions = exclusionSubPaths.get(key);
        if (subExclusions) {
          for (const sub of subExclusions) {
            subRules.push({
              raw: `-${sub}`,
              exclude: true,
              path: sub,
              modifier: null,
            });
          }
        }

        applyRulesToMap(child as Record<string, unknown>, subRules);
      } else if (hasRemainder) {
        // Path leads to a non-object with sub-path expectations — delete
        delete data[key];
      }
    }
  }
}
