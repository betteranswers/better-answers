import { eslintCompatPlugin } from "@oxlint/plugins";

import { commentOnlyTheWhyRule } from "./rules/comment-only-the-why.ts";
import { importDirectionRule } from "./rules/import-direction.ts";
import { mcpEntryAnnotationsRule } from "./rules/mcp-entry-annotations.ts";
import { mcpEntryNoWorkspaceArgumentRule } from "./rules/mcp-entry-no-workspace-argument.ts";

const betterAnswersPlugin = eslintCompatPlugin({
  meta: { name: "better-answers" },
  rules: {
    "comment-only-the-why": commentOnlyTheWhyRule,
    "import-direction": importDirectionRule,
    "mcp-entry-annotations": mcpEntryAnnotationsRule,
    "mcp-entry-no-workspace-argument": mcpEntryNoWorkspaceArgumentRule,
  },
});

export default betterAnswersPlugin;
