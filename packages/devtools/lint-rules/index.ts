import { eslintCompatPlugin } from "@oxlint/plugins";

import { importDirectionRule } from "./rules/import-direction.ts";
import { mcpEntryAnnotationsRule } from "./rules/mcp-entry-annotations.ts";
import { mcpEntryNoWorkspaceArgumentRule } from "./rules/mcp-entry-no-workspace-argument.ts";

/**
 * The repository's own oxlint rules — the ones that hold a `CODING_RULES.md` or ADR
 * line rather than a generic hygiene pattern (those are `anti-slop`'s). Each rule is
 * run by a functional test over a throwaway tree, because a rule nobody has run is a
 * convention: the two MCP rules in `apps/api/tests/lint-rules.test.ts`, the import
 * direction rule in `packages/core/test/import-direction.test.ts`.
 */
const betterAnswersPlugin = eslintCompatPlugin({
  meta: { name: "better-answers" },
  rules: {
    "import-direction": importDirectionRule,
    "mcp-entry-annotations": mcpEntryAnnotationsRule,
    "mcp-entry-no-workspace-argument": mcpEntryNoWorkspaceArgumentRule,
  },
});

export default betterAnswersPlugin;
