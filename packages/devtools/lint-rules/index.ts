import { eslintCompatPlugin } from "@oxlint/plugins";

import { actAdmitsBeforeAwaitRule } from "./rules/act-admits-before-await.ts";
import { commentOnlyTheWhyRule } from "./rules/comment-only-the-why.ts";
import { importDirectionRule } from "./rules/import-direction.ts";
import { mcpEntryAnnotationsRule } from "./rules/mcp-entry-annotations.ts";
import { mcpEntryNoWorkspaceArgumentRule } from "./rules/mcp-entry-no-workspace-argument.ts";
import { stringCitesNothingRule } from "./rules/string-cites-nothing.ts";

const betterAnswersPlugin = eslintCompatPlugin({
  meta: { name: "better-answers" },
  rules: {
    "act-admits-before-await": actAdmitsBeforeAwaitRule,
    "comment-only-the-why": commentOnlyTheWhyRule,
    "import-direction": importDirectionRule,
    "mcp-entry-annotations": mcpEntryAnnotationsRule,
    "mcp-entry-no-workspace-argument": mcpEntryNoWorkspaceArgumentRule,
    "string-cites-nothing": stringCitesNothingRule,
  },
});

export default betterAnswersPlugin;
