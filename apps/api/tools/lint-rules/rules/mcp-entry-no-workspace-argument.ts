import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { entryCallOf, findProperty, propertyName } from "../shared/entry-calls.ts";

/**
 * No MCP entry takes a workspace, bundle or tenant argument (ADR 0018, `[SEC2]`): the
 * principal comes from the token and never from an argument. The rule reads the
 * entry's input schema — `defineEntry`'s `input` or `registerTool`'s `inputSchema`,
 * as `z.object({ … })` or a raw shape — and refuses any key that names one of the
 * three. The functional test over the emitted `inputSchema` holds it at runtime.
 */
const FORBIDDEN = ["workspace", "bundle", "tenant"];

const shapeOf = (value: ESTree.Node): ESTree.ObjectExpression | undefined => {
  if (value.type === "ObjectExpression") return value;
  // z.object({ … }) — the first argument is the shape.
  if (
    value.type === "CallExpression" &&
    value.callee.type === "MemberExpression" &&
    !value.callee.computed &&
    value.callee.property.type === "Identifier" &&
    value.callee.property.name === "object"
  ) {
    const [shape] = value.arguments;
    return shape !== undefined && shape.type === "ObjectExpression" ? shape : undefined;
  }
  return undefined;
};

export const mcpEntryNoWorkspaceArgumentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "No MCP entry input names a workspace, bundle or tenant.",
    },
    messages: {
      forbidden:
        "`{{name}}` is not an argument an MCP entry may take: the principal comes from the token, never from an argument (ADR 0018, [SEC2]).",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const call = entryCallOf(node);
        if (
          call === undefined ||
          call.config === undefined ||
          call.config.type !== "ObjectExpression"
        )
          return;
        const input = findProperty(
          call.config,
          call.kind === "defineEntry" ? "input" : "inputSchema",
        );
        if (input === undefined) return;
        const shape = shapeOf(input.value);
        if (shape === undefined) return;
        for (const property of shape.properties) {
          const name = propertyName(property);
          if (name === undefined) continue;
          const lowered = name.toLowerCase();
          if (FORBIDDEN.some((word) => lowered.includes(word))) {
            context.report({ node: property, messageId: "forbidden", data: { name } });
          }
        }
      },
    };
  },
});
