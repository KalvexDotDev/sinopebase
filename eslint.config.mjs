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
      globals: { console: "readonly", Bun: "readonly" },
    },
  },

  // NOTE: eslint-plugin-elysia is installed at
  //   @boring-stack-pkg/eslint-plugin-elysia
  // and provides 12 ElysiaJS-specific rules (method chaining, lifecycle
  // ordering, plugin naming, schema errors, etc.).
  //
  // It is DISABLED until @typescript-eslint/parser supports TypeScript 7.
  //   https://github.com/typescript-eslint/typescript-eslint/issues/10940
  //
  // In the meantime, Elysia convention rules are enforced via Semgrep:
  //   .semgrep-elysia.yml (loaded by security:semgrep and CI)
  //
  // When ready, uncomment:
  //   import tsParser from "@typescript-eslint/parser";
  //   import elysia from "@boring-stack-pkg/eslint-plugin-elysia";
  //   {
  //     files: ["src/**/*.ts", "tests/**/*.ts"],
  //     languageOptions: { parser: tsParser, ... },
  //     plugins: { elysia },
  //     rules: elysia.configs.recommended.rules,
  //   }
];
