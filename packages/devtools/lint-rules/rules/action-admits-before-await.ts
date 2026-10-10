import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const DECLARE = "declareAction";

const ADMIT = "admit";

/** The two shorthands admit on their own call, so only `admit` names a declaration to pair. */
const ADMITTING = new Set([ADMIT, "requireAdmin", "requireFreshSignIn"]);

/** The visitors fire in source order, so whichever of the two lands first is the earlier one. */
type Frame = {
  readonly first: "awaited" | "admitted" | undefined;
  readonly admitted: ESTree.CallExpression | undefined;
};

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
        "A function that admits does so before it awaits, and a declared action is admitted by one.",
    },
    messages: {
      late: "This function awaits before it admits: run `{{name}}` first, so nothing is opened, read or written for a principal the action was never going to serve (the root `CODING_STANDARDS.md`).",
      unadmitted:
        "`{{name}}` declares what an action admits and no function here passes it to `admit`, so the declaration states a gate nothing runs (the root `CODING_STANDARDS.md`).",
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
        const name = calleeName(frame.admitted) ?? ADMIT;
        context.report({ node: frame.admitted, messageId: "late", data: { name } });
      }
    };

    const noteAwait = (): void => {
      const frame = frames.at(-1);
      if (frame === undefined || frame.first !== undefined) return;
      frames[frames.length - 1] = { ...frame, first: "awaited" };
    };

    const noteAdmit = (node: ESTree.CallExpression): void => {
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
        const name = calleeName(node);
        if (name === undefined || !ADMITTING.has(name)) return;
        noteAdmit(node);
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
        frames.length = 0;
      },
    };
  },
});
