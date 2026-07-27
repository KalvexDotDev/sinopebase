import js from "@eslint/js";
import security from "eslint-plugin-security";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "ui/**",
      ".claude/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,

  // JavaScript files: security plugin + strictness.
  // Applies to .js/.mjs/.cjs files in src/ and tests/.
  // Currently zero JS files — the project is pure TypeScript.
  // TS coverage is provided by:
  //   • Biome: noExplicitAny (error), correctness, suspicious, recommended
  //   • Semgrep: TypeScript SAST rules (injection, XSS, path traversal, secrets)
  //   • tsc: strict mode, noUncheckedIndexedAccess, noFallthroughCasesInSwitch
  //
  // NOTE: @typescript-eslint does not support TypeScript 7 yet.
  // When it does, add @typescript-eslint rules to this config for .ts files.
  //   https://github.com/typescript-eslint/typescript-eslint/issues/10940
  {
    files: ["src/**/*.js", "src/**/*.mjs", "src/**/*.cjs", "tests/**/*.js", "tests/**/*.mjs"],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        Bun: "readonly",
      },
    },
  },
];
