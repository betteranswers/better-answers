import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { entryCallOf, findProperty, propertyName } from "../shared/entry-calls.ts";

const FORBIDDEN = ["workspace", "bundle", "tenant"];

const WRAPPERS = new Set(["refine", "superRefine", "transform", "describe", "brand", "readonly"]);

const shapeOf = (value: ESTree.Node): ESTree.ObjectExpression | undefined => {
  if (value.type === "ObjectExpression") return value;
  if (value.type !== "CallExpression") return undefined;
  const { callee } = value;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property.type !== "Identifier"
  ) {
    return undefined;
  }

  if (callee.property.name === "object") {
    const [shape] = value.arguments;
    return shape !== undefined && shape.type === "ObjectExpression" ? shape : undefined;
  }

  if (WRAPPERS.has(callee.property.name)) return shapeOf(callee.object);
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
      opaque:
        "This MCP entry's input is not an inline `z.object({ … })` or raw shape, so its keys cannot be checked here; declare the shape inline (the runtime test over the emitted schema is the fence for a registration from data).",
      spread:
        "A spread or computed key in an MCP entry's input cannot be checked for a workspace argument; write the keys out.",
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
        if (shape === undefined) {
          context.report({ node: input, messageId: "opaque" });
          return;
        }
        for (const property of shape.properties) {
          const name = propertyName(property);
          if (name === undefined) {
            context.report({ node: property, messageId: "spread" });
            continue;
          }
          const lowered = name.toLowerCase();
          if (FORBIDDEN.some((word) => lowered.includes(word))) {
            context.report({ node: property, messageId: "forbidden", data: { name } });
          }
        }
      },
    };
  },
});
