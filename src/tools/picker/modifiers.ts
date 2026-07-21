/**
 * Field modifier system for the picker tool.
 *
 * Port of PocketBase tools/picker/modifiers.go
 * Layer 1 -- imports from Layer 0 tokenizer.
 */

import { Tokenizer } from "~/tools/tokenizer/tokenizer.ts";

// ---------------------------------------------------------------------------
// Modifier
// ---------------------------------------------------------------------------

/**
 * A modifier transforms a picked field's value.
 */
export interface Modifier {
  /** Executes the modifier and returns a new modified value. */
  modify(value: unknown): unknown;
}

// ---------------------------------------------------------------------------
// ModifierFactory
// ---------------------------------------------------------------------------

/**
 * A factory function that creates a Modifier from string arguments.
 */
export type ModifierFactory = (...args: string[]) => Modifier;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Global registry of named modifier factories.
 *
 * Register custom modifiers by adding entries to this object:
 *
 * @example
 * ```ts
 * import { Modifiers } from "./modifiers.ts";
 * import { excerptModifierFactory } from "./excerpt_modifier.ts";
 *
 * Modifiers["excerpt"] = excerptModifierFactory;
 * ```
 */
export const Modifiers: Record<string, ModifierFactory> = {};

// ---------------------------------------------------------------------------
// initModifier
// ---------------------------------------------------------------------------

/**
 * Parses a raw modifier expression string and returns the corresponding
 * Modifier instance.
 *
 * A modifier expression has the format: `name(arg1,arg2,...)`.
 *
 * @example
 *   initModifier("excerpt(100,true)")   → excerpt modifier with max=100, ellipsis=true
 *   initModifier("lower")               → lower modifier
 */
export function initModifier(rawModifier: string): Modifier {
  const t = new Tokenizer(rawModifier);
  t.SetSeparators("(", ")", ",", " ");
  t.SetIgnoreParenthesis(true);

  const parts = t.ScanAll();

  if (parts.length === 0) {
    throw new Error(
      `invalid or empty modifier expression "${rawModifier}"`,
    );
  }

  const name = parts[0]!;
  const args = parts.slice(1);

  const factory = Modifiers[name];
  if (!factory) {
    throw new Error(`missing or invalid modifier "${name}"`);
  }

  return factory(...args);
}
