import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const DECLARE = "declareAct";

const ADMIT = "admit";

// The visitors fire in source order, so whichever of the two lands first is the earlier one.
type Frame = {
  readonly first: "awaited" | "admitted" | undefined;
  readonly admitted: ESTree.Node | undefined;
};

const calleeName = (node: ESTree.CallExpression): string | undefined =>
  node.callee.type === "Identifier" ? node.callee.name : undefined;

const namedFirstArgument = (node: ESTree.CallExpression): string | undefined => {
  const [first] = node.arguments;
  return first !== undefined && first.type === "Identifier" ? first.name : undefined;
};

export const actAdmitsBeforeAwaitRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "A declared act runs its admission before it awaits anything.",
    },
    messages: {
      late: "This act awaits before it admits: run `admit` first, so nothing is opened, read or written for a principal the act was never going to serve ([SEC5]).",
      unadmitted:
        "`{{name}}` declares what an act admits and no function here passes it to `admit`, so the declaration states a gate nothing runs ([SEC5]).",
    },
  },
  createOnce(context) {
    const frames: Frame[] = [];
    const declared = new Map<string, ESTree.Node>();
    const admitted = new Set<string>();

    const open = (): void => {
      frames.push({ first: undefined, admitted: undefined });
    };

    const close = (): void => {
      const frame = frames.pop();
      if (frame?.first === "awaited" && frame.admitted !== undefined) {
        context.report({ node: frame.admitted, messageId: "late" });
      }
    };

    const noteAwait = (): void => {
      const frame = frames.at(-1);
      if (frame === undefined || frame.first !== undefined) return;
      frames[frames.length - 1] = { ...frame, first: "awaited" };
    };

    const noteAdmit = (node: ESTree.Node): void => {
      const frame = frames.at(-1);
      if (frame === undefined) return;
      frames[frames.length - 1] = {
        first: frame.first ?? "admitted",
        admitted: frame.admitted ?? node,
      };
    };

    return {
      FunctionDeclaration: open,
      "FunctionDeclaration:exit": close,
      FunctionExpression: open,
      "FunctionExpression:exit": close,
      ArrowFunctionExpression: open,
      "ArrowFunctionExpression:exit": close,

      AwaitExpression: noteAwait,

      CallExpression(node) {
        if (calleeName(node) !== ADMIT) return;
        noteAdmit(node);
        const asked = namedFirstArgument(node);
        if (asked !== undefined) admitted.add(asked);
      },

      VariableDeclarator(node) {
        const { id, init } = node;
        if (id.type !== "Identifier" || init === null) return;
        if (init.type === "CallExpression" && calleeName(init) === DECLARE)
          declared.set(id.name, id);
      },

      "Program:exit"(): void {
        for (const [name, node] of declared) {
          if (!admitted.has(name)) {
            context.report({ node, messageId: "unadmitted", data: { name } });
          }
        }
        declared.clear();
        admitted.clear();
        frames.length = 0;
      },
    };
  },
});
