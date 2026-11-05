import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const DECLARE = "declareAction";

const ADMIT = "admit";

const ADMITTING = new Set([ADMIT, "requireFreshConfirmation"]);

const calleeName = (node: ESTree.CallExpression): string | undefined =>
  node.callee.type === "Identifier" ? node.callee.name : undefined;

const namedFirstArgument = (node: ESTree.CallExpression): string | undefined => {
  const [first] = node.arguments;
  return first !== undefined && first.type === "Identifier" ? first.name : undefined;
};

export const actionAdmitsBeforeAwaitRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A function calls `admit` before its first `await`, and some function passes each declared action to `admit`.",
    },
    messages: {
      late: "This function awaits before it calls `{{name}}`. Call `{{name}}` before the first `await`, so the action opens, reads and writes nothing for a principal it will refuse.",
      unadmitted:
        "`{{name}}` declares who an action admits, but no function in this file passes it to `admit`, so nothing enforces the declaration. Pass `{{name}}` to `admit` in the function that runs the action.",
    },
  },
  createOnce(context) {
    const awaited: boolean[] = [];
    const declared = new Map<string, ESTree.Node>();
    const admitted = new Set<string>();

    const open = (): void => {
      awaited.push(false);
    };

    const close = (): void => {
      awaited.pop();
    };

    const noteAwait = (): void => {
      if (awaited.length > 0) awaited[awaited.length - 1] = true;
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
        const name = calleeName(node);
        if (name === undefined || !ADMITTING.has(name)) return;
        if (awaited.at(-1) === true) context.report({ node, messageId: "late", data: { name } });
        if (name !== ADMIT) return;
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
        awaited.length = 0;
      },
    };
  },
});
