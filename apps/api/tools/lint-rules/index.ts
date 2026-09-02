import { eslintCompatPlugin } from "@oxlint/plugins";

import { mcpEntryAnnotationsRule } from "./rules/mcp-entry-annotations.ts";
import { mcpEntryNoWorkspaceArgumentRule } from "./rules/mcp-entry-no-workspace-argument.ts";

/**
 * The repository's own oxlint rules — the ones that hold a `CODING_RULES.md` or ADR
 * line rather than a generic hygiene pattern (those are `anti-slop`'s). Each rule is
 * run by a functional test in `apps/api/tests/lint-rules.test.ts` over a throwaway
 * tree, because a rule nobody has run is a convention.
 */
const betterAnswersPlugin = eslintCompatPlugin({
  meta: { name: "better-answers" },
  rules: {
    "mcp-entry-annotations": mcpEntryAnnotationsRule,
    "mcp-entry-no-workspace-argument": mcpEntryNoWorkspaceArgumentRule,
  },
});

export default betterAnswersPlugin;
