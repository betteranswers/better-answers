import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { climbWritten, placementOfFile, reachesRoot, ROOTS_OF } from "../shared/path-climb.ts";

export const noPathClimbRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A path anchored to a file does not climb to its workspace's root or out of it; it joins from the workspace's roots helper.",
    },
    messages: {
      climbs:
        "`{{written}}` climbs to the root of `{{workspace}}` or out of it, so the path breaks when this file moves. Import {{exports}} from `{{file}}` and join the path from there.",
      climbsWithoutHelper:
        "`{{written}}` climbs to the root of `{{workspace}}` or out of it, so the path breaks when this file moves. `{{workspace}}` has no roots helper yet, so add one beside its tests and join the path from there.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node): void => {
      const written = climbWritten(node);
      if (written === undefined) return;
      const placed = placementOfFile(context.filename);
      if (placed === null || !reachesRoot(placed.depth, written)) return;
      const helper = ROOTS_OF.get(placed.workspace);
      const data = { written, workspace: placed.workspace };
      if (helper === undefined) {
        context.report({ node, messageId: "climbsWithoutHelper", data });
        return;
      }
      const exports = helper.exports.map((name) => `\`${name}\``).join(" or ");
      context.report({ node, messageId: "climbs", data: { ...data, exports, file: helper.file } });
    };
    return { NewExpression: check, CallExpression: check };
  },
});
