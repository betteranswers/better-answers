import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  climbOf,
  importsToolchainRoot,
  placementOfFile,
  reachesRoot,
  ROOTS_OF,
  TOOLCHAIN_PATHS,
  TOOLCHAIN_WORKSPACE,
} from "../shared/path-climb.ts";
import type { RootsHelper } from "../shared/path-climb.ts";

const MOST_WRITTEN = 60;

const named = (helper: RootsHelper): string =>
  helper.exports.map((name) => `\`${name}\``).join(" or ");

export const noPathClimbRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A path built from a file's location does not climb to its workspace's root or out of it, and the root comes from the workspace's roots helper.",
    },
    messages: {
      climbs:
        "`{{written}}` climbs to the root of `{{workspace}}` or out of it, so a move breaks the path. Import {{exports}} from `{{file}}` and join the path from there.",
      climbsWithoutHelper:
        "`{{written}}` climbs to the root of `{{workspace}}` or out of it, so a move breaks the path. `{{workspace}}` has no roots helper yet, so add one beside its tests and join the path from there.",
      importsToolchainRoot: `\`{{workspace}}\` takes \`repositoryRoot\` from its roots helper, so import {{exports}} from \`{{file}}\`, not from \`${TOOLCHAIN_PATHS}\`.`,
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
      const helper = ROOTS_OF.get(placed.workspace);
      const data = { written: textOf(node), workspace: placed.workspace };
      if (helper === undefined) {
        context.report({ node, messageId: "climbsWithoutHelper", data });
        return;
      }
      context.report({
        node,
        messageId: "climbs",
        data: { ...data, exports: named(helper), file: helper.file },
      });
    };
    const checkImport = (node: ESTree.ImportDeclaration): void => {
      if (!importsToolchainRoot(node)) return;
      const placed = placementOfFile(context.filename);
      const helper = placed === null ? undefined : ROOTS_OF.get(placed.workspace);
      if (placed === null || helper === undefined) return;
      if (placed.workspace === TOOLCHAIN_WORKSPACE || placed.file === helper.file) return;
      context.report({
        node,
        messageId: "importsToolchainRoot",
        data: { workspace: placed.workspace, exports: named(helper), file: helper.file },
      });
    };
    return {
      NewExpression: checkClimb,
      CallExpression: checkClimb,
      TemplateLiteral: checkClimb,
      ImportDeclaration: checkImport,
    };
  },
});
