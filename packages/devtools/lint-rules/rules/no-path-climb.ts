import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { climbWritten, placementOfFile, reachesRoot, ROOTS_OF } from "../shared/path-climb.ts";

const NO_HELPER = "the workspace's roots helper, which it does not have yet";

export const noPathClimbRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A path anchored to a file does not climb to its workspace's root or out of it; it joins from the workspace's roots helper.",
    },
    messages: {
      climbs:
        "`{{written}}` climbs to the root of {{workspace}} or out of it, so the path breaks when this file moves. Import `repositoryRoot` or `workspaceRoot` from {{helper}} and join the path from there.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node): void => {
      const written = climbWritten(node);
      if (written === undefined) return;
      const placed = placementOfFile(context.filename);
      if (placed === null || !reachesRoot(placed.depth, written)) return;
      const helper = ROOTS_OF.get(placed.workspace);
      context.report({
        node,
        messageId: "climbs",
        data: {
          written,
          workspace: `\`${placed.workspace}\``,
          helper: helper === undefined ? NO_HELPER : `\`${helper}\``,
        },
      });
    };
    return { NewExpression: check, CallExpression: check };
  },
});
