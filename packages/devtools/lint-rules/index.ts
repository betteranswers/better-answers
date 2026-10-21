import { eslintCompatPlugin } from "@oxlint/plugins";

import { actionAdmitsBeforeAwaitRule } from "./rules/action-admits-before-await.ts";
import { authTypesStayInTheSeamRule } from "./rules/auth-types-stay-in-the-seam.ts";
import { commentOnlyTheWhyRule } from "./rules/comment-only-the-why.ts";
import { declarationDocBlockRule } from "./rules/declaration-doc-block.ts";
import { importDirectionRule } from "./rules/import-direction.ts";
import { importStaticallyRule } from "./rules/import-statically.ts";
import { mcpEntryAnnotationsRule } from "./rules/mcp-entry-annotations.ts";
import { mcpEntryNoWorkspaceArgumentRule } from "./rules/mcp-entry-no-workspace-argument.ts";
import { parameterNeverMutatedRule } from "./rules/parameter-never-mutated.ts";
import { stringCitesNothingRule } from "./rules/string-cites-nothing.ts";

const betterAnswersPlugin = eslintCompatPlugin({
  meta: { name: "better-answers" },
  rules: {
    "action-admits-before-await": actionAdmitsBeforeAwaitRule,
    "auth-types-stay-in-the-seam": authTypesStayInTheSeamRule,
    "comment-only-the-why": commentOnlyTheWhyRule,
    "declaration-doc-block": declarationDocBlockRule,
    "import-direction": importDirectionRule,
    "import-statically": importStaticallyRule,
    "mcp-entry-annotations": mcpEntryAnnotationsRule,
    "mcp-entry-no-workspace-argument": mcpEntryNoWorkspaceArgumentRule,
    "parameter-never-mutated": parameterNeverMutatedRule,
    "string-cites-nothing": stringCitesNothingRule,
  },
});

export default betterAnswersPlugin;
