// Complexity gate ONLY — this is not a style linter. Every function written
// or modified must keep cyclomatic complexity ≤ 8 (decompose into named
// helpers instead of nesting).
//
// Two entry points:
//   pnpm lint:complexity          — whole repo, ADVISORY: legacy functions
//                                   over the cap fail this until touched
//                                   (record the violation count at adoption).
//   pnpm lint:complexity:changed  — files changed vs origin/main; THE GATE,
//                                   run by CI on every PR. Touch a legacy
//                                   offender and it must come out ≤ 8.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".wrangler/**",
      ".worktrees/**",
      ".stryker-tmp/**",
      "reports/**",
      ".playwright-mcp/**",
      "playwright-report/**",
      "test-results/**",
      // Build-time generated code is not authored code — list your repo's
      // generated paths here (e.g. "src/generated/**").
      "src/generated/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      complexity: ["error", 8],
    },
  },
);
