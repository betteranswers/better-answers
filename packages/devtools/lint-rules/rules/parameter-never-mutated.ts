import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope } from "@oxlint/plugins";

/**
 * Map and Set methods are left out, as a parameter holding one is often a collector; so is
 * `fill`, a Playwright locator method.
 */
const MUTATORS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "copyWithin",
]);

const nameOf = (node: ESTree.Node | undefined): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

const targetOf = (node: ESTree.CallExpression, method: string): ESTree.Node | undefined => {
  if (node.callee.type !== "MemberExpression") return undefined;
  if (nameOf(node.callee.object) === "Object" && method === "assign") return node.arguments[0];
  return MUTATORS.has(method) ? node.callee.object : undefined;
};

const mutated = (
  node: ESTree.CallExpression,
): { readonly name: string; readonly method: string } | undefined => {
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  const method = callee.property.name;
  const name = nameOf(targetOf(node, method));
  return name === undefined ? undefined : { name, method };
};

const isParameter = (from: Scope, name: string): boolean => {
  for (let scope: Scope | null = from; scope !== null; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable !== undefined) return variable.defs[0]?.type === "Parameter";
  }
  return false;
};

export const parameterNeverMutatedRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "A function never mutates a parameter; it returns a new value.",
    },
    messages: {
      mutated:
        "`{{method}}` changes the parameter `{{name}}` in place, so the caller's value changes too. Never mutate a parameter: return a new value, built from a copy such as `[...{{name}}]` or `{ ...{{name}} }`, or with a copying method such as `toSorted`.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const found = mutated(node);
        if (found === undefined) return;
        if (isParameter(context.sourceCode.getScope(node), found.name)) {
          context.report({ node, messageId: "mutated", data: found });
        }
      },
    };
  },
});
