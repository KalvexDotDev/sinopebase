#!/usr/bin/env node
/**
 * Run ESLint on JS files only.
 *
 * Finds .js / .mjs / .cjs files in src/ and tests/, skipping if none exist.
 * This project is pure TypeScript; this script is future-proof for when JS
 * files are added, and prevents ESLint from erroring on unmatched TS globs.
 *
 * When @typescript-eslint adds TypeScript 7 support, extend to .ts files:
 *   https://github.com/typescript-eslint/typescript-eslint/issues/10940
 *
 * Usage:
 *   bun run scripts/lint-eslint.mjs                    # plain lint
 *   bun run scripts/lint-eslint.mjs --format @microsoft/eslint-formatter-sarif --output-file results.sarif
 */

import { readdirSync } from "fs";
import { resolve, relative } from "path";
import { spawnSync } from "child_process";

const EXT_RE = /\.(js|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "ui", ".claude", ".git"]);

function findJsFiles(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          stack.push(full);
        }
      } else if (entry.isFile() && EXT_RE.test(entry.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

const srcFiles = findJsFiles(resolve("src"));
const testFiles = findJsFiles(resolve("tests"));
const files = [...srcFiles, ...testFiles];

if (files.length === 0) {
  console.log("[eslint] No JS files found — skipping ESLint");
  process.exit(0);
}

const extraArgs = process.argv.slice(2);
const args = [...extraArgs, ...files];

console.log(`[eslint] Linting ${files.length} JS file(s)...`);
const proc = spawnSync("npx", ["eslint", ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
});

process.exit(proc.status ?? 1);
