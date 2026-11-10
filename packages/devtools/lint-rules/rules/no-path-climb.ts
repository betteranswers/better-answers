import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { climbOf, placementOfFile, reachesRoot, ROOTS_HELPER } from "../shared/path-climb.ts";

const MOST_WRITTEN = 60;

export const noPathClimbRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: `A path built from a file's location does not climb to its workspace root or above it. The root comes from \`${ROOTS_HELPER.name}(import.meta.url)\`.`,
    },
    messages: {
      climbs: `\`{{written}}\` climbs to the root of \`{{workspace}}\` or above it, so the path breaks when the file moves. Import \`${ROOTS_HELPER.name}\` from \`${ROOTS_HELPER.specifier}\`, take \`repositoryRoot\` or \`workspaceRoot\` from \`${ROOTS_HELPER.name}(import.meta.url)\`, and join the path from there.`,
    },
  },
  createOnce(context) {
    const textOf = (node: ESTree.Node): string => {
      const text = context.sourceCode.getText(node);
      return text.length <= MOST_WRITTEN ? text : `${text.slice(0, MOST_WRITTEN)}...`;
    };
    const checkClimb = (node: ESTree.Node): void => {
      const climb = climbOf(node);
      if (climb === undefined) return;
      const placed = placementOfFile(context.filename);
      if (placed === null) return;
      const depth = climb.fromCwd ? 0 : placed.depth;
      if (!reachesRoot(depth, climb.rise, climb.written)) return;
      context.report({
        node,
        messageId: "climbs",
        data: { written: textOf(node), workspace: placed.workspace },
      });
    };
    return {
      NewExpression: checkClimb,
      CallExpression: checkClimb,
      TemplateLiteral: checkClimb,
    };
  },
});
